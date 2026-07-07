export function LogoMark({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 500 500"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M299.128 139.002V238.504C298.97 238.503 298.812 238.501 298.654 238.501C240.444 238.501 193.256 285.807 193.256 344.161C193.256 344.319 193.258 344.476 193.259 344.634H94.0031C94.0028 344.476 94 344.319 94 344.161C94 230.854 185.627 139 298.654 139C298.812 139 298.97 139.001 299.128 139.002Z"
        fill="currentColor"
      />
      <path
        d="M299.128 238.5H405V344.633H299.128V238.5Z"
        fill="currentColor"
      />
    </svg>
  );
}
