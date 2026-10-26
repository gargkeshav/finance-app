import type { ChangeSet } from "../../domain/history";

interface HistoryViewProps {
  history: ChangeSet[];
  onRevert: () => void;
}

function changeSummary(change: ChangeSet): string {
  const counts = new Map<string, { changed: number; added: number; removed: number }>();
  for (const record of change.records) {
    const count = counts.get(record.collection) ?? { changed: 0, added: 0, removed: 0 };
    if (record.before === null) count.added += 1;
    else if (record.after === null) count.removed += 1;
    else count.changed += 1;
    counts.set(record.collection, count);
  }

  return [...counts.entries()].map(([collection, count]) => {
    const details = [
      count.changed > 0 ? `${count.changed} changed` : "",
      count.added > 0 ? `${count.added} added` : "",
      count.removed > 0 ? `${count.removed} removed` : "",
    ].filter(Boolean).join(", ");
    return `${collection}: ${details}`;
  }).join("; ");
}

export function HistoryView({ history, onRevert }: HistoryViewProps) {
  const newestFirst = [...history].reverse();

  return (
    <section>
      <div className="page-heading">
        <h1>History</h1>
      </div>
      {newestFirst.length === 0 ? (
        <p className="empty-state compact">Labelled changes will appear here.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Time</th><th>By</th><th>Change</th><th>Records</th><th>Action</th></tr>
            </thead>
            <tbody>
              {newestFirst.map((change, index) => (
                <tr key={change.id}>
                  <td>{new Date(change.at).toLocaleString()}</td>
                  <td>{change.actor}</td>
                  <td>{change.reason}</td>
                  <td>{changeSummary(change)}</td>
                  <td>{index === 0 && (
                    <button
                      className="secondary"
                      onClick={() => {
                        if (window.confirm(`Revert "${change.reason}"?`)) onRevert();
                      }}
                      type="button"
                    >
                      Revert
                    </button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}