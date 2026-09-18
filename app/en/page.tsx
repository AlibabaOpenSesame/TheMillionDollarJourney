import CommandCenter from "../live/CommandCenter";
import { loadLiveDashboard } from "../live/load";

export default async function EnglishDashboard() {
  return <CommandCenter locale="en" initial={await loadLiveDashboard()} />;
}
