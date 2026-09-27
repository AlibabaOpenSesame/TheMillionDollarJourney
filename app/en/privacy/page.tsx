import LegalPage, { legalMetadata } from "../../LegalPage";

export const metadata = legalMetadata("en", "privacy");

export default function EnglishPrivacyPage() {
  return <LegalPage locale="en" doc="privacy" />;
}
