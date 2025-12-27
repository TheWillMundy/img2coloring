import ColoringBookDemo from "./components/coloring-book-demo";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f6f1e7] text-neutral-900">
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_50%_-20%,rgba(255,255,255,0.9),rgba(246,241,231,0.75),rgba(239,231,217,0.95))]" />
        <div className="pointer-events-none absolute -top-48 right-[-10%] h-[30rem] w-[30rem] rounded-full bg-[radial-gradient(circle,rgba(242,202,139,0.75),rgba(242,202,139,0))] opacity-60 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-56 left-[-10%] h-[32rem] w-[32rem] rounded-full bg-[radial-gradient(circle,rgba(239,167,148,0.6),rgba(239,167,148,0))] opacity-50 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-6 pb-6 pt-16 sm:pb-8 sm:pt-20 lg:pb-6">
          <ColoringBookDemo />
        </div>
      </div>
    </main>
  );
}
