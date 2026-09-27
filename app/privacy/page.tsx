import LegalPage, { legalMetadata } from "../LegalPage";

export const metadata = legalMetadata("zh", "privacy");

export default function PrivacyPage() {
  return <LegalPage locale="zh" doc="privacy" />;
}
