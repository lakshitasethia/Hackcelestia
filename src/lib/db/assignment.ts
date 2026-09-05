import "server-only";
import { serviceRoleClient } from "./client";

/**
 * Who runs a trip the traveler planned for themselves.
 *
 * A trip composed from a sentence had no operator and no coordinator, because
 * `createTrip` had nowhere to get one from. That is defensible as a data state
 * — nobody has picked it up yet — and it is wrong as a product: the operator
 * board reads `operator_id = current_operator_id()` and the guide's run sheet
 * reads `coordinator_name is not null`, so a self-planned trip was invisible to
 * both, and every disruption, blast-radius and re-plan feature in this codebase
 * was unreachable from a trip the traveler had just made.
 *
 * So accepting a proposal now assigns one. The rule is deliberately dull: one
 * house operator handles self-planned trips, and the trip inherits that
 * operator's coordinator. It is not routing by destination — there is no data
 * for that, and inventing some would be a guess dressed as a decision.
 */

/**
 * Set `VOYAGE_DEFAULT_OPERATOR_ID` to choose deliberately. Without it we take
 * the oldest operator, which is the one the deployment was seeded around.
 *
 * The research operator is excluded by name: `ingestResearch` creates it to own
 * unverified catalogue rows, it has no staff and no contact anybody can call,
 * and handing it a live trip would put a group in the care of a bookkeeping
 * device.
 */
const RESEARCH_OPERATOR_NAME = "Voyage Research";

export type Assignment = {
  operatorId: string | null;
  coordinatorId: string | null;
  coordinatorName: string | null;
  coordinatorPhone: string | null;
};

export async function houseAssignment(): Promise<Assignment> {
  const supabase = serviceRoleClient();

  const configured = process.env.VOYAGE_DEFAULT_OPERATOR_ID?.trim();

  let operatorId: string | null = null;
  if (configured) {
    const { data } = await supabase
      .from("operators")
      .select("id")
      .eq("id", configured)
      .maybeSingle();
    operatorId = (data as { id: string } | null)?.id ?? null;
  }

  if (!operatorId) {
    const { data } = await supabase
      .from("operators")
      .select("id, name")
      .neq("name", RESEARCH_OPERATOR_NAME)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    operatorId = (data as { id: string } | null)?.id ?? null;
  }

  // No operator at all is a legitimate state on a bare database. The trip is
  // still created and still belongs to the traveler; it simply reaches no
  // board, which is exactly what it did before and is better than failing the
  // accept.
  if (!operatorId) {
    return {
      operatorId: null,
      coordinatorId: null,
      coordinatorName: null,
      coordinatorPhone: null,
    };
  }

  const { data: coordinator } = await supabase
    .from("profiles")
    .select("id, full_name, phone")
    .eq("role", "coordinator")
    .eq("operator_id", operatorId)
    .limit(1)
    .maybeSingle();

  const person = coordinator as
    | { id: string; full_name: string | null; phone: string | null }
    | null;

  return {
    operatorId,
    coordinatorId: person?.id ?? null,
    // `coordinator_name` rather than only the id, because the run sheet filters
    // on the name — it predates sign-in and is what tells an assigned group
    // from an unassigned one.
    coordinatorName: person?.full_name?.trim() || null,
    coordinatorPhone: person?.phone ?? null,
  };
}
