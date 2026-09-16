import type { Metadata } from "next";
import JadeKeyExperience from "./JadeKeyExperience";
import styles from "./jade-key.module.css";

export const metadata: Metadata = {
  title: "祥云玉钥 · Three.js 高拟真三维重建",
  description: "依据正视与侧视参考，以 Three.js 程序化重建的祥云玉石金钥匙。",
};

export default function JadeKeyPage() {
  return (
    <main className={styles.page}>
      <JadeKeyExperience />
    </main>
  );
}
