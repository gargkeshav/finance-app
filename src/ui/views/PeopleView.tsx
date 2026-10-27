import { useEffect, useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Entity | null>(null);
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
    setDialogOpen(false);
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
    setDialogOpen(true);
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
    setDialogOpen(false);
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
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>People</h1>
        <Button onClick={() => { cancelEditing(); setDialogOpen(true); }} type="button">Add person</Button>
      </header>

      {error && <p className="rounded-md border p-3 text-sm border-destructive/40 text-destructive" role="alert">{error}</p>}
      <div className="min-w-0 max-w-full overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Kind</TableHead><TableHead>Status</TableHead><TableHead>Splitwise</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {ledger.entities.map((entity) => {
              const fixed = entity.id === SELF_ENTITY_ID || entity.id === HOUSE_ENTITY_ID;
              return (
                <TableRow key={entity.id}>
                  <TableCell><Button variant="link" className="h-auto p-0" onClick={() => openActivity({ entityId: entity.id })} type="button">{entity.name}</Button></TableCell>
                  <TableCell><span className="rounded-full border px-2 py-0.5 text-xs">{kindLabels[entity.kind]}</span></TableCell>
                  <TableCell>{entity.archived ? "Archived" : "Active"}</TableCell>
                  <TableCell>
                    {(entity.kind === "person" || entity.kind === "group") && connected && (
                      <div className="grid gap-2">
                        <Label>{entity.kind === "person" ? "Splitwise friend" : "Splitwise group"}</Label>
                        <Select value={links[entity.id] ?? entity.splitwise?.id ?? ""} onValueChange={(value) => setLinks({ ...links, [entity.id]: value ?? "" })}>
                          <SelectTrigger aria-label={entity.kind === "person" ? "Splitwise friend" : "Splitwise group"}><SelectValue placeholder="Choose" /></SelectTrigger>
                          <SelectContent>
                            {(entity.kind === "person" ? friends : groups).map((remote) => (
                              <SelectItem key={remote.id} value={remote.id}>{entity.kind === "person" ? `${(remote as SplitwiseUser).first_name} ${(remote as SplitwiseUser).last_name}` : (remote as SplitwiseGroup).name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="flex gap-2">
                          <Button variant="outline" onClick={() => linkSplitwise(entity)} type="button">Link</Button>
                          {entity.splitwise && <Button variant="outline" disabled={busyEntityId === entity.id} onClick={() => void pullSplitwise(entity)} type="button">{busyEntityId === entity.id ? "Pulling..." : "Pull"}</Button>}
                        </div>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {!fixed && (
                      <div className="flex gap-2">
                        <Button variant="outline" onClick={() => editEntity(entity)} type="button">Edit person</Button>
                        <Button variant="outline" onClick={() => setArchiveTarget(entity)} type="button">{entity.archived ? "Restore" : "Archive"}</Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) cancelEditing(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit person" : "Add person"}</DialogTitle>
            <DialogDescription>Add or update a person or group in your ledger.</DialogDescription>
          </DialogHeader>
        <form className="grid gap-4" onSubmit={saveEntity}>
          <div className="grid gap-2"><Label htmlFor="person-name">Name</Label><Input id="person-name" value={name} onChange={(event) => setName(event.target.value)} required /></div>
          {!editingId && <div className="grid gap-2"><Label>Kind</Label><Select value={kind} onValueChange={(value) => setKind(value as "person" | "group")}>
            <SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="person">Person</SelectItem><SelectItem value="group">Group</SelectItem></SelectContent>
          </Select></div>}
          {kind === "group" && <>
            <div className="grid gap-2"><Label>Type</Label><Select value={groupType} onValueChange={(value) => setGroupType(value as GroupType)}>
              <SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="household">Household</SelectItem><SelectItem value="trip">Trip</SelectItem><SelectItem value="friends">Friends</SelectItem><SelectItem value="project">Project</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent>
            </Select></div>
            <fieldset>
              <legend>Members</legend>
              {ledger.entities.filter((entity) => entity.kind === "person" && (!entity.archived || members.some((member) => member.entityId === entity.id))).map((person) => {
                const member = members.find((item) => item.entityId === person.id);
                return (
                  <div className="grid gap-2" key={person.id}>
                    <Label className="flex items-center gap-2">
                      <Checkbox checked={Boolean(member)} onCheckedChange={(checked) => setMembers((current) => checked
                        ? [...current, { entityId: person.id, weight: "1" }]
                        : current.filter((item) => item.entityId !== person.id))} />
                      {person.name}
                    </Label>
                    {member && <div className="grid gap-2"><Label>Weight</Label><Input min="1" step="1" type="number" value={member.weight} onChange={(event) => setMembers((current) => current.map((item) => item.entityId === person.id ? { ...item, weight: event.target.value } : item))} required /></div>}
                  </div>
                );
              })}
              {ledger.entities.every((entity) => entity.kind !== "person") && <p className="text-muted-foreground">Add a person to set group members.</p>}
            </fieldset>
            <div className="grid gap-2"><Label>Default split</Label><Select value={defaultMode} onValueChange={(value) => setDefaultMode(value as "none" | "shares" | "percent")}>
              <SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No default</SelectItem><SelectItem value="shares">Equal shares</SelectItem><SelectItem value="percent">Percent to you</SelectItem></SelectContent>
            </Select></div>
            {defaultMode === "percent" && <div className="grid gap-2"><Label>Percent to you</Label><Input max="100" min="0" step="1" type="number" value={yourPercent} onChange={(event) => setYourPercent(event.target.value)} required /></div>}
          </>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter><Button type="submit">{editingId ? "Edit person" : "Add person"}</Button></DialogFooter>
        </form>
        </DialogContent>
      </Dialog>

      <Card aria-label="Splitwise">
        <CardHeader><CardTitle>Splitwise</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
        <p className="text-muted-foreground">{connected ? `Connected as ${connectedName}` : "Not connected"}</p>
        {!connected && <form className="grid gap-4" onSubmit={connectSplitwise}>
          <div className="grid gap-2"><Label htmlFor="splitwise-curl">Paste a request copied as cURL from splitwise.com</Label><Textarea id="splitwise-curl" autoComplete="off" value={curlText} onChange={(event) => setCurlText(event.target.value)} required rows={5} /></div>
          <div className="flex justify-end"><Button type="submit">{sessionExpired ? "Reconnect" : "Connect"}</Button></div>
        </form>}
        {connected && <>
          <p>Request headers: {headerNames.join(", ")}</p>
          <div className="grid gap-4">
            <div className="grid gap-2"><Label htmlFor="splitwise-since">First pull since</Label><Input id="splitwise-since" type="date" value={sinceDate} onChange={(event) => setSinceDate(event.target.value)} /></div>
            <div><Button variant="outline" onClick={disconnectSplitwise} type="button">Disconnect</Button></div>
          </div>
        </>}
        </CardContent>
      </Card>
      <AlertDialog open={Boolean(archiveTarget)} onOpenChange={(open) => { if (!open) setArchiveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{archiveTarget?.archived ? "Restore this entity?" : "Archive this entity?"}</AlertDialogTitle>
            <AlertDialogDescription>{archiveTarget?.archived ? `Restore ${archiveTarget.name} to the active list.` : `Archive ${archiveTarget?.name}. Its history will be kept.`}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (archiveTarget) { toggleArchived(archiveTarget); setArchiveTarget(null); } }}>{archiveTarget?.archived ? "Restore" : "Archive"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}