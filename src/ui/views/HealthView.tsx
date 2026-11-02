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
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Data checks and follow-up</p>
          <h1 className="text-2xl font-semibold tracking-tight">Health</h1>
        </div>
        <Button onClick={() => onNavigate("Review")} type="button">Review items</Button>
      </header>
      {groups.length === 0 ? (
        <Card><CardContent className="p-4"><Empty>All clear</Empty></CardContent></Card>
      ) : (
        <section className="rounded-lg border bg-muted/30 px-4 py-3" aria-label="Items needing attention">
          <p className="font-medium">{count} item{count === 1 ? "" : "s"} need attention</p>
          <p className="text-sm text-muted-foreground">Open a category to review the details and go to the right workspace.</p>
        </section>
      )}
      {groups.map((group) => {
        const groupCount = group.issues.reduce((total, issue) => total + issue.count, 0);
        return (
          <Card key={group.kind} className="overflow-hidden">
            <details>
              <summary className="cursor-pointer list-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <CardHeader className="py-3">
                  <CardTitle className="flex items-center justify-between gap-3 text-base">
                    <span>{group.kind}</span>
                    <Badge variant="secondary">{groupCount}</Badge>
                  </CardTitle>
                </CardHeader>
              </summary>
              <CardContent className="grid gap-2 pt-0">
                {group.issues.map((issue, index) => (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t py-2" key={`${issue.detail}-${index}`}>
                    <p className="min-w-0 flex-1 text-sm">{issue.detail}</p>
                    <Button size="sm" variant="outline" onClick={() => onNavigate(issue.view)} type="button">Open {issue.view}</Button>
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