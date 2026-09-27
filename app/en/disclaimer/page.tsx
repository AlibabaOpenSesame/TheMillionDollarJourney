import LegalPage, { legalMetadata } from "../../LegalPage";

export const metadata = legalMetadata("en", "disclaimer");

export default function EnglishDisclaimerPage() {
  return <LegalPage locale="en" doc="disclaimer" />;
}
