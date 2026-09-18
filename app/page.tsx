export const dynamic = "force-dynamic";
export const revalidate = 0;

import PortfolioDashboard from "./PortfolioDashboard";
import { loadPortfolio } from "./load-portfolio";

export default async function Home() {
  const initial = await loadPortfolio("CNY");
  return <PortfolioDashboard locale="zh" initial={initial} />;
}
