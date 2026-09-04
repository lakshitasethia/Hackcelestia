/**
 * Vela — the concierge's face.
 *
 * Named for the constellation that was the sails of the Argo, which is about as
 * on-the-nose as a travel product gets, and it keeps the star motif the loader
 * already uses.
 *
 * The brief was "cute", and the design system is not: it is uppercase, angular
 * and two-tone. So the charm is in the character and the movement — a star that
 * blinks and breathes — and never in a rounded pastel bubble that would look
 * pasted on from another product. Everything here is `currentColor`, so she
 * takes the palette of whatever she is sitting in.
 */
export default function Vela({
  className = "",
  thinking = false,
}: {
  className?: string;
  /** Eyes close while she works, and the whole star pulses gently. */
  thinking?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
      role="presentation"
    >
      {/* The four-point star: a compass rose drawn as one path so it scales
          cleanly at 20px, which is the size it is used at most often. */}
      <path
        d="M16 1.5 19.1 11 28.5 16 19.1 21 16 30.5 12.9 21 3.5 16 12.9 11Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        fill="none"
        className={thinking ? "vela-breathe" : undefined}
      />
      {/* Eyes. Scaled about their own centres so a blink squashes rather than
          shrinks — the difference between blinking and vanishing. */}
      <g className={thinking ? "vela-eyes-shut" : "vela-blink"}>
        <circle cx="13.4" cy="15.2" r="1.15" fill="currentColor" />
        <circle cx="18.6" cy="15.2" r="1.15" fill="currentColor" />
      </g>
      <path
        d="M13.6 18.4c.7.85 1.5 1.27 2.4 1.27s1.7-.42 2.4-1.27"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
