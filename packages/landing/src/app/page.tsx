import { Nav } from "@/components/nav";
import { Hero } from "@/components/hero";
import { ProductDemo } from "@/components/product-demo";
import { ZkProof } from "@/components/zk-proof";
import { TechStack } from "@/components/tech-stack";
import { Footer } from "@/components/footer";

export default function Home() {
  return (
    <div className="grain scanlines">
      <Nav />
      <Hero />
      <ProductDemo />
      <ZkProof />
      <TechStack />
      <Footer />
    </div>
  );
}
