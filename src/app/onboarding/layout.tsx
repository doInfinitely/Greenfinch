import Image from 'next/image';

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="h-14 border-b border-gray-200 bg-white flex items-center px-6">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 relative flex-shrink-0">
            <Image
              src="/greenfinch-logo.png"
              alt="Greenfinch"
              fill
              sizes="32px"
              className="object-contain"
              priority
            />
          </div>
          <span className="font-semibold text-lg text-foreground">greenfinch.ai</span>
        </div>
      </header>
      <main className="flex-1 flex items-start justify-center py-12 px-4">
        <div className="w-full max-w-2xl">
          {children}
        </div>
      </main>
    </div>
  );
}
