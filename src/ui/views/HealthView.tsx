import type { HealthIssue, HealthViewName } from "../../domain/health";

interface HealthViewProps {
  issues: HealthIssue[];
  onNavigate: (view: HealthViewName) => void;
}

export function HealthView({ issues, onNavigate }: HealthViewProps) {
  const groups = [...new Set(issues.map((issue) => issue.kind))].map((kind) => ({
    kind,
    issues: issues.filter((issue) => issue.kind === kind),
  }));
  const count = issues.reduce((total, issue) => total + issue.count, 0);

  return (
    <>
      <header className="page-heading">
        <h1>Health</h1>
        <button className="primary" onClick={() => onNavigate("Review")} type="button">Review items</button>
      </header>
      {groups.length === 0 ? (
        <section className="empty-state compact">Nothing needs attention.</section>
      ) : (
        <section className="summary-strip" aria-label="Items needing attention">
          <span className="metric-label">{count} item{count === 1 ? "" : "s"} need attention</span>
        </section>
      )}
      {groups.map((group) => (
        <section className="card" key={group.kind}>
          <header className="section-heading">
            <h2>{group.kind}</h2>
            <span className="nav-count">{group.issues.reduce((total, issue) => total + issue.count, 0)}</span>
          </header>
          <div className="table-scroll">
            <table>
              <tbody>
                {group.issues.map((issue, index) => (
                  <tr key={`${issue.detail}-${index}`}>
                    <td>{issue.detail}</td>
                    <td>
                      <button className="secondary" onClick={() => onNavigate(issue.view)} type="button">
                        Open {issue.view}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}