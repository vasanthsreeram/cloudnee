/** Supersession: one current value per functional source+relation pair. */

export const FUNCTIONAL_RELATIONS = ["lives_in", "quoted_price"] as const;

export function isFunctionalRelation(relation: string): boolean {
  return (FUNCTIONAL_RELATIONS as readonly string[]).includes(relation);
}

export interface SuperEdge {
  id: string;
  sourceId: string;
  relation: string;
  targetId: string;
  path: string;
  createdAt: number;
  supersededBy: string | null;
}

function keyOf(edge: SuperEdge): string {
  return `${edge.sourceId}|${edge.relation}|${edge.targetId}`;
}

export function applySupersession(edges: readonly SuperEdge[]): SuperEdge[] {
  const next = edges.map((edge) => ({ ...edge }));
  const winners = new Map<string, SuperEdge>();

  for (const edge of next) {
    if (edge.supersededBy !== null || !isFunctionalRelation(edge.relation)) continue;
    const group = `${edge.sourceId}|${edge.relation}`;
    const current = winners.get(group);
    if (
      current === undefined ||
      edge.createdAt > current.createdAt ||
      (edge.createdAt === current.createdAt && edge.id > current.id)
    ) {
      winners.set(group, edge);
    }
  }

  for (const edge of next) {
    if (edge.supersededBy !== null || !isFunctionalRelation(edge.relation)) continue;
    const winner = winners.get(`${edge.sourceId}|${edge.relation}`);
    if (winner !== undefined && winner.id !== edge.id) edge.supersededBy = winner.id;
  }

  return next;
}

export function retireMissingPathEdges(
  edges: readonly SuperEdge[],
  path: string,
  incomingKeys: ReadonlySet<string>,
  replacedBy: string,
): SuperEdge[] {
  return edges.map((edge) => {
    if (edge.supersededBy !== null) return { ...edge };
    if (edge.path !== path) return { ...edge };
    if (incomingKeys.has(keyOf(edge))) return { ...edge };
    return { ...edge, supersededBy: replacedBy };
  });
}
