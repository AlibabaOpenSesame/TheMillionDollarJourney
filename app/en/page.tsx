export const dynamic = "force-dynamic";
export const revalidate = 0;

import PortfolioDashboard from "../PortfolioDashboard";
import { loadPortfolio } from "../load-portfolio";

export default async function EnglishDashboard() {
  const initial = await loadPortfolio("USD");
  return <PortfolioDashboard locale="en" initial={initial} />;
}
