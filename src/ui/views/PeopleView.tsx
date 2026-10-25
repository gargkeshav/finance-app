import { useState } from "react";
import { HOUSE_ENTITY_ID, SELF_ENTITY_ID, type Entity, type EntityKind, type Ledger } from "../../domain/ledger";

interface PeopleViewProps {
  ledger: Ledger;
  update: (next: Ledger) => void;
}

export function PeopleView({ ledger, update }: PeopleViewProps) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"person" | "group">("person");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");

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
        <button className="primary" onClick={() => { setEditingId(null); setName(""); setError(""); }} type="button">Add person or group</button>
      </header>

      <form className="form-grid" onSubmit={saveEntity}>
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        {!editingId && (
          <label>
            Kind
            <select value={kind} onChange={(event) => setKind(event.target.value as "person" | "group")}>
              <option value="person">Person</option>
              <option value="group">Group</option>
            </select>
          </label>
        )}
        <div className="dialog-actions">
          <button className="primary" type="submit">{editingId ? "Save name" : "Add"}</button>
          {editingId && <button className="secondary" onClick={() => setEditingId(null)} type="button">Cancel</button>}
        </div>
        {error && <p className="banner error" role="alert">{error}</p>}
      </form>

      <div className="table-scroll">
        <table>
          <thead><tr><th>Name</th><th>Kind</th><th>Status</th><th /></tr></thead>
          <tbody>
            {ledger.entities.map((entity) => {
              const fixed = entity.id === SELF_ENTITY_ID || entity.id === HOUSE_ENTITY_ID;
              return (
                <tr key={entity.id}>
                  <td>{entity.name}</td>
                  <td>{kindLabels[entity.kind]}</td>
                  <td>{entity.archived ? "Archived" : "Active"}</td>
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
    </>
  );
}