import CommandCenter from "./live/CommandCenter";
import { loadLiveDashboard } from "./live/load";

export default async function Home() {
  return <CommandCenter locale="zh" initial={await loadLiveDashboard()} />;
}
