import LegalPage, { legalMetadata } from "../LegalPage";

export const metadata = legalMetadata("zh", "disclaimer");

export default function DisclaimerPage() {
  return <LegalPage locale="zh" doc="disclaimer" />;
}
