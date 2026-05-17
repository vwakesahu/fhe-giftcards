import { Nav } from "@/components/nav";
import { Hero } from "@/components/hero";
import { ProductDemo } from "@/components/product-demo";
import { FlowDiagram } from "@/components/flow-diagram";
import { ZkProof } from "@/components/zk-proof";
import { TechStack } from "@/components/tech-stack";
import { Footer } from "@/components/footer";

export default function Home() {
  return (
    <main>
      <Nav />
      <Hero />
      <ProductDemo />
      <FlowDiagram />
      <ZkProof />
      <TechStack />
      <Footer />
    </main>
  );
}
