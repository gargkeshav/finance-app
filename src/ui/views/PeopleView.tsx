import { useState } from "react";
import { HOUSE_ENTITY_ID, SELF_ENTITY_ID, type Entity, type EntityKind, type Ledger } from "../../domain/ledger";
import { getCurrentUser, getExpenses, getFriends, getGroups, pullIntoInbox, setKey, type SplitwiseGroup, type SplitwiseUser } from "../../adapters/splitwise";

interface PeopleViewProps {
  ledger: Ledger;
  update: (next: Ledger) => void;
}

export function PeopleView({ ledger, update }: PeopleViewProps) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"person" | "group">("person");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [connectedName, setConnectedName] = useState("");
  const [friends, setFriends] = useState<SplitwiseUser[]>([]);
  const [groups, setGroups] = useState<SplitwiseGroup[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [sinceDate, setSinceDate] = useState("");
  const [busyEntityId, setBusyEntityId] = useState<string | null>(null);
  const connected = Boolean(connectedName);

  async function connectSplitwise(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const key = String(data.get("splitwise-key") ?? "");
    setKey(key);
    setConnectedName("");
    setFriends([]);
    setGroups([]);
    setError("");
    form.reset();
    try {
      const [user, friendList, groupList] = await Promise.all([getCurrentUser(), getFriends(), getGroups()]);
      setConnectedName(`${user.first_name} ${user.last_name}`.trim());
      setFriends(friendList);
      setGroups(groupList);
      setError("");
    } catch (cause) {
      setKey("");
      setConnectedName("");
      setFriends([]);
      setGroups([]);
      setError(cause instanceof Error ? cause.message : "Could not connect to Splitwise.");
    }
  }

  function disconnectSplitwise() {
    setKey("");
    setConnectedName("");
    setFriends([]);
    setGroups([]);
    setError("");
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
    if (editingId) {
      update({
        ...ledger,
        entities: ledger.entities.map((entity) =>
          entity.id === editingId ? { ...entity, name: trimmedName } : entity,
        ),
      });
    } else {
      const entity: Entity = {
        id: crypto.randomUUID(),
        kind,
        name: trimmedName,
        archived: false,
        updatedAt: new Date().toISOString(),
      };
      update({ ...ledger, entities: [...ledger.entities, entity] });
    }
    setName("");
    setEditingId(null);
    setError("");
  }

  function editEntity(entity: Entity) {
    setEditingId(entity.id);
    setName(entity.name);
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
                  <td>{entity.name}</td>
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
        <div className="section-heading"><h2>{editingId ? "Rename person or group" : "Add person or group"}</h2></div>
        <form className="form-grid" onSubmit={saveEntity}>
          <label>Name<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
          {!editingId && <label>Kind<select value={kind} onChange={(event) => setKind(event.target.value as "person" | "group")}>
            <option value="person">Person</option><option value="group">Group</option>
          </select></label>}
          <div className="dialog-actions">
            <button className="primary" type="submit">{editingId ? "Save name" : "Add"}</button>
            {editingId && <button className="secondary" onClick={() => setEditingId(null)} type="button">Cancel</button>}
          </div>
        </form>
      </section>

      <section className="card" aria-label="Splitwise">
        <div className="section-heading"><h2>Splitwise</h2></div>
        <p className="muted">{connected ? `Connected as ${connectedName}` : "Not connected"}</p>
        {!connected && <form className="form-grid" onSubmit={connectSplitwise}>
          <label>API key<input autoComplete="new-password" name="splitwise-key" type="password" required /></label>
          <div className="dialog-actions"><button className="primary" type="submit">Connect</button></div>
        </form>}
        {connected && <>
          <div className="form-grid">
            <label>First pull since<input type="date" value={sinceDate} onChange={(event) => setSinceDate(event.target.value)} /></label>
            <div className="dialog-actions"><button className="secondary" onClick={disconnectSplitwise} type="button">Disconnect</button></div>
          </div>
        </>}
      </section>
    </>
  );
}