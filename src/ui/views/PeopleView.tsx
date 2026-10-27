import { useEffect, useState } from "react";
import { HOUSE_ENTITY_ID, SELF_ENTITY_ID, type Entity, type EntityKind, type GroupType, type Ledger } from "../../domain/ledger";
import type { EntryFilter } from "../../domain/query";
import {
  connectSession,
  disconnectSession,
  getCurrentUser,
  getExpenses,
  getFriends,
  getGroups,
  pullIntoInbox,
  sessionStatus,
  SplitwiseSessionExpiredError,
  type SplitwiseGroup,
  type SplitwiseUser,
} from "../../adapters/splitwise";

interface PeopleViewProps {
  ledger: Ledger;
  update: (next: Ledger) => void;
  openActivity: (filter: EntryFilter) => void;
}

export function PeopleView({ ledger, update, openActivity }: PeopleViewProps) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"person" | "group">("person");
  const [groupType, setGroupType] = useState<GroupType>("other");
  const [members, setMembers] = useState<{ entityId: string; weight: string }[]>([]);
  const [defaultMode, setDefaultMode] = useState<"none" | "shares" | "percent">("none");
  const [yourPercent, setYourPercent] = useState("50");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [connectedName, setConnectedName] = useState("");
  const [curlText, setCurlText] = useState("");
  const [headerNames, setHeaderNames] = useState<string[]>([]);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [friends, setFriends] = useState<SplitwiseUser[]>([]);
  const [groups, setGroups] = useState<SplitwiseGroup[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [sinceDate, setSinceDate] = useState("");
  const [busyEntityId, setBusyEntityId] = useState<string | null>(null);
  const connected = Boolean(connectedName);

  useEffect(() => {
    let active = true;
    async function restoreSession() {
      try {
        const status = await sessionStatus();
        if (!active || !status.connected) return;
        const [user, friendList, groupList] = await Promise.all([getCurrentUser(), getFriends(), getGroups()]);
        if (!active) return;
        setConnectedName(`${user.first_name} ${user.last_name}`.trim());
        setHeaderNames(status.headerNames);
        setFriends(friendList);
        setGroups(groupList);
        setSessionExpired(false);
      } catch (cause) {
        if (!active) return;
        setConnectedName("");
        setSessionExpired(cause instanceof SplitwiseSessionExpiredError);
        setError(cause instanceof Error ? cause.message : "Could not restore the Splitwise session.");
      }
    }
    void restoreSession();
    return () => { active = false; };
  }, []);

  async function connectSplitwise(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = curlText;
    setCurlText("");
    setConnectedName("");
    setHeaderNames([]);
    setFriends([]);
    setGroups([]);
    setSessionExpired(false);
    setError("");
    try {
      await connectSession(text);
      const [user, friendList, groupList, status] = await Promise.all([
        getCurrentUser(),
        getFriends(),
        getGroups(),
        sessionStatus(),
      ]);
      setConnectedName(`${user.first_name} ${user.last_name}`.trim());
      setHeaderNames(status.headerNames);
      setFriends(friendList);
      setGroups(groupList);
      setError("");
      setSessionExpired(false);
    } catch (cause) {
      setConnectedName("");
      setHeaderNames([]);
      setFriends([]);
      setGroups([]);
      setSessionExpired(cause instanceof SplitwiseSessionExpiredError);
      setError(cause instanceof Error ? cause.message : "Could not connect to Splitwise.");
    }
  }

  async function disconnectSplitwise() {
    try {
      await disconnectSession();
      setConnectedName("");
      setHeaderNames([]);
      setFriends([]);
      setGroups([]);
      setSessionExpired(false);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not disconnect Splitwise.");
    }
  }

  function linkSplitwise(entity: Entity) {
    const id = links[entity.id];
    if (!id) return;
    const now = new Date().toISOString();
    update({
      ...ledger,
      entities: ledger.entities.map((candidate) => candidate.id === entity.id
        ? { ...candidate, splitwise: { kind: entity.kind === "person" ? "user" : "group", id }, updatedAt: now }
        : candidate),
    });
  }

  async function pullSplitwise(entity: Entity) {
    if (!entity.splitwise) return;
    const sync = (ledger.splitwiseSync ?? []).find((item) => item.entityId === entity.id);
    if (!sync && !sinceDate) {
      setError("Choose a since date for the first pull.");
      return;
    }
    setBusyEntityId(entity.id);
    try {
      const pulledAt = new Date().toISOString();
      const [user, expenses] = await Promise.all([
        getCurrentUser(),
        getExpenses(entity.splitwise, sync ? { updatedAfter: sync.lastPulledAt } : { datedAfter: sinceDate }),
      ]);
      update(pullIntoInbox(ledger, entity, expenses, user.id, pulledAt));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not pull Splitwise expenses.");
    } finally {
      setBusyEntityId(null);
    }
  }

  function saveEntity(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter a name.");
      return;
    }
    const parsedMembers = members.map((member) => ({ entityId: member.entityId, weight: Number(member.weight) }));
    if (kind === "group" && parsedMembers.some((member) => !Number.isSafeInteger(member.weight) || member.weight <= 0)) {
      setError("Member weights must be positive whole numbers.");
      return;
    }
    const percent = Number(yourPercent);
    if (kind === "group" && defaultMode === "percent" && (!Number.isInteger(percent) || percent < 0 || percent > 100)) {
      setError("Your percentage must be a whole number from 0 to 100.");
      return;
    }
    const groupFields = kind === "group" ? {
      groupType,
      members: parsedMembers,
      defaultAllocation: defaultMode === "shares"
        ? { mode: "shares" as const }
        : defaultMode === "percent"
          ? { mode: "percent" as const, yourPercent: percent }
          : undefined,
    } : {};
    if (editingId) {
      update({
        ...ledger,
        entities: ledger.entities.map((entity) =>
          entity.id === editingId
            ? { ...entity, ...groupFields, name: trimmedName, updatedAt: new Date().toISOString() }
            : entity,
        ),
      });
    } else {
      const entity: Entity = {
        id: crypto.randomUUID(),
        kind,
        name: trimmedName,
        archived: false,
        updatedAt: new Date().toISOString(),
        ...groupFields,
      };
      update({ ...ledger, entities: [...ledger.entities, entity] });
    }
    setName("");
    setEditingId(null);
    setMembers([]);
    setError("");
  }

  function editEntity(entity: Entity) {
    setEditingId(entity.id);
    setName(entity.name);
    setKind(entity.kind === "group" ? "group" : "person");
    setGroupType(entity.groupType ?? "other");
    setMembers((entity.members ?? []).map((member) => ({ entityId: member.entityId, weight: String(member.weight) })));
    setDefaultMode(entity.defaultAllocation?.mode ?? "none");
    setYourPercent(entity.defaultAllocation?.mode === "percent" ? String(entity.defaultAllocation.yourPercent) : "50");
    setError("");
  }

  function cancelEditing() {
    setEditingId(null);
    setName("");
    setKind("person");
    setGroupType("other");
    setMembers([]);
    setDefaultMode("none");
    setYourPercent("50");
    setError("");
  }

  function toggleArchived(entity: Entity) {
    update({
      ...ledger,
      entities: ledger.entities.map((item) =>
        item.id === entity.id ? { ...item, archived: !item.archived } : item,
      ),
    });
  }

  const kindLabels: Record<EntityKind, string> = {
    self: "You",
    house: "House",
    person: "Person",
    group: "Group",
  };

  return (
    <>
      <header className="page-heading">
        <h1>People</h1>
      </header>

      {error && <p className="banner error" role="alert">{error}</p>}
      <div className="table-scroll">
        <table>
          <thead><tr><th>Name</th><th>Kind</th><th>Status</th><th>Splitwise</th><th /></tr></thead>
          <tbody>
            {ledger.entities.map((entity) => {
              const fixed = entity.id === SELF_ENTITY_ID || entity.id === HOUSE_ENTITY_ID;
              return (
                <tr key={entity.id}>
                  <td><button className="transaction-link" onClick={() => openActivity({ entityId: entity.id })} type="button">{entity.name}</button></td>
                  <td><span className="allocation-tag">{kindLabels[entity.kind]}</span></td>
                  <td>{entity.archived ? "Archived" : "Active"}</td>
                  <td>
                    {(entity.kind === "person" || entity.kind === "group") && connected && (
                      <div>
                        <label>
                          {entity.kind === "person" ? "Splitwise friend" : "Splitwise group"}
                          <select value={links[entity.id] ?? entity.splitwise?.id ?? ""} onChange={(event) => setLinks({ ...links, [entity.id]: event.target.value })}>
                            <option value="">Choose</option>
                            {(entity.kind === "person" ? friends : groups).map((remote) => (
                              <option key={remote.id} value={remote.id}>{entity.kind === "person" ? `${(remote as SplitwiseUser).first_name} ${(remote as SplitwiseUser).last_name}` : (remote as SplitwiseGroup).name}</option>
                            ))}
                          </select>
                        </label>
                        <button className="secondary" onClick={() => linkSplitwise(entity)} type="button">Link</button>{" "}
                        {entity.splitwise && <button className="secondary" disabled={busyEntityId === entity.id} onClick={() => void pullSplitwise(entity)} type="button">{busyEntityId === entity.id ? "Pulling..." : "Pull"}</button>}
                      </div>
                    )}
                  </td>
                  <td>
                    {!fixed && (
                      <>
                        <button className="secondary" onClick={() => editEntity(entity)} type="button">Rename</button>{" "}
                        <button className="secondary" onClick={() => toggleArchived(entity)} type="button">
                          {entity.archived ? "Restore" : "Archive"}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="card" aria-label="Add person or group">
        <div className="section-heading"><h2>{editingId ? "Edit person or group" : "Add person or group"}</h2></div>
        <form className="form-grid" onSubmit={saveEntity}>
          <label>Name<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
          {!editingId && <label>Kind<select value={kind} onChange={(event) => setKind(event.target.value as "person" | "group")}>
            <option value="person">Person</option><option value="group">Group</option>
          </select></label>}
          {kind === "group" && <>
            <label>Type<select value={groupType} onChange={(event) => setGroupType(event.target.value as GroupType)}>
              <option value="household">Household</option><option value="trip">Trip</option><option value="friends">Friends</option><option value="project">Project</option><option value="other">Other</option>
            </select></label>
            <fieldset>
              <legend>Members</legend>
              {ledger.entities.filter((entity) => entity.kind === "person" && (!entity.archived || members.some((member) => member.entityId === entity.id))).map((person) => {
                const member = members.find((item) => item.entityId === person.id);
                return (
                  <div className="form-grid" key={person.id}>
                    <label className="checkbox-label">
                      <input type="checkbox" checked={Boolean(member)} onChange={(event) => setMembers((current) => event.target.checked
                        ? [...current, { entityId: person.id, weight: "1" }]
                        : current.filter((item) => item.entityId !== person.id))} />
                      {person.name}
                    </label>
                    {member && <label>Weight<input min="1" step="1" type="number" value={member.weight} onChange={(event) => setMembers((current) => current.map((item) => item.entityId === person.id ? { ...item, weight: event.target.value } : item))} required /></label>}
                  </div>
                );
              })}
              {ledger.entities.every((entity) => entity.kind !== "person") && <p className="muted">Add a person to set group members.</p>}
            </fieldset>
            <label>Default split<select value={defaultMode} onChange={(event) => setDefaultMode(event.target.value as "none" | "shares" | "percent")}>
              <option value="none">No default</option><option value="shares">Equal shares</option><option value="percent">Percent to you</option>
            </select></label>
            {defaultMode === "percent" && <label>Percent to you<input max="100" min="0" step="1" type="number" value={yourPercent} onChange={(event) => setYourPercent(event.target.value)} required /></label>}
          </>}
          <div className="dialog-actions">
            <button className="primary" type="submit">{editingId ? "Save" : "Add"}</button>
            {editingId && <button className="secondary" onClick={cancelEditing} type="button">Cancel</button>}
          </div>
        </form>
      </section>

      <section className="card" aria-label="Splitwise">
        <div className="section-heading"><h2>Splitwise</h2></div>
        <p className="muted">{connected ? `Connected as ${connectedName}` : "Not connected"}</p>
        {!connected && <form className="form-grid" onSubmit={connectSplitwise}>
          <label>Paste a request copied as cURL from splitwise.com<textarea autoComplete="off" value={curlText} onChange={(event) => setCurlText(event.target.value)} required rows={5} /></label>
          <div className="dialog-actions"><button className="primary" type="submit">{sessionExpired ? "Reconnect" : "Connect"}</button></div>
        </form>}
        {connected && <>
          <p>Request headers: {headerNames.join(", ")}</p>
          <div className="form-grid">
            <label>First pull since<input type="date" value={sinceDate} onChange={(event) => setSinceDate(event.target.value)} /></label>
            <div className="dialog-actions"><button className="secondary" onClick={disconnectSplitwise} type="button">Disconnect</button></div>
          </div>
        </>}
      </section>
    </>
  );
}