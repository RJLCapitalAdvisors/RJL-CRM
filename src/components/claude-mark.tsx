/**
 * The ✦ that sits on every button whose click calls Claude (Nov 12, 2026), so the cost is known before the click.
 * Put it inside the button, after the label. A new button that reaches src/lib/claude.ts gets one too.
 */
export function ClaudeMark({ className = "" }: { className?: string }) {
  return (
    <span title="Uses Claude credits" aria-label="Uses Claude credits" role="img" className={`ml-1 inline-block cursor-help text-[0.85em] leading-none opacity-80 ${className}`}>
      ✦
    </span>
  );
}
