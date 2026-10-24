export function VSCodeIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M17.7 2 7.4 9.5 3.1 6.2 1 7.5v9l2.1 1.3 4.3-3.3L17.7 22 23 19.4V4.6L17.7 2Zm-.4 5.2v9.6L10.8 12l6.5-4.8ZM3.5 9.4 6.8 12l-3.3 2.6V9.4Z"
        fill="#007ACC"
      />
      <path d="M17.7 2 23 4.6v14.8L17.7 22V2Z" fill="#23A9F2" />
    </svg>
  );
}
