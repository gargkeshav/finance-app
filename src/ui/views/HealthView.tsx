import type { HealthIssue, HealthViewName } from "../../domain/health";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";

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
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Health</h1>
        <Button onClick={() => onNavigate("Review")} type="button">Review items</Button>
      </header>
      {groups.length === 0 ? (
        <Empty>All clear</Empty>
      ) : (
        <section className="flex flex-wrap gap-4" aria-label="Items needing attention">
          <span className="text-sm text-muted-foreground">{count} item{count === 1 ? "" : "s"} need attention</span>
        </section>
      )}
      {groups.map((group) => {
        const groupCount = group.issues.reduce((total, issue) => total + issue.count, 0);
        return (
          <Card key={group.kind}>
            <details>
              <summary className="cursor-pointer list-none">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-3">
                    <span>{group.kind}</span>
                    <Badge variant="secondary">{groupCount}</Badge>
                  </CardTitle>
                </CardHeader>
              </summary>
              <CardContent className="grid gap-3">
                {group.issues.map((issue, index) => (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3" key={`${issue.detail}-${index}`}>
                    <p>{issue.detail}</p>
                    <Button variant="link" onClick={() => onNavigate(issue.view)} type="button">Open {issue.view}</Button>
                  </div>
                ))}
              </CardContent>
            </details>
          </Card>
        );
      })}
    </>
  );
}