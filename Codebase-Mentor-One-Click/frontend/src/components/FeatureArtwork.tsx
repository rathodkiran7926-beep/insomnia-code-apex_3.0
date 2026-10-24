/** Decorative diagrams for the four home-page capabilities. */
export function FeatureArtwork({ kind }: { kind: 'atlas' | 'journey' | 'practice' | 'knowledge' }) {
  return (
    <div className={`feature-art feature-art--${kind}`} aria-hidden="true">
      <svg viewBox="0 0 320 180" fill="none" focusable="false">
        {kind === 'atlas' && <>
          <path d="M160 52v32M65 110V84h190v26M160 84v47" className="art-connector" />
          <rect x="114" y="15" width="92" height="43" rx="12" className="art-node" />
          <rect x="25" y="110" width="80" height="44" rx="12" className="art-node" />
          <rect x="120" y="129" width="80" height="44" rx="12" className="art-node" />
          <rect x="215" y="110" width="80" height="44" rx="12" className="art-node" />
          <path d="m150 28-10 9 10 9m20-18 10 9-10 9M49 132h32m63 19h32m63-19h32" className="art-glyph" />
          <circle cx="160" cy="84" r="6" className="art-dot" />
        </>}
        {kind === 'journey' && <>
          <path d="M26 141h65V96h75V53h128" className="art-connector art-connector--dashed" />
          {[ [26,141], [91,96], [166,53], [280,53] ].map(([x,y], i) =>
            <g key={i}><circle cx={x} cy={y} r="19" className="art-node" /><circle cx={x} cy={y} r="5" className="art-dot" /></g>)}
          <path d="m266 16 14-9 14 9m-14-9v24" className="art-glyph" />
          <path d="M42 171h56m18-42h44m32-42h44" className="art-connector" opacity=".3" />
        </>}
        {kind === 'practice' && <>
          <rect x="28" y="16" width="264" height="147" rx="16" className="art-node" />
          <path d="M28 48h264" className="art-connector" />
          {[47,59,71].map(x => <circle key={x} cx={x} cy="32" r="3" className="art-dot" />)}
          <path d="M54 73h68m-56 22h108m-108 22h82m-94 22h44" className="art-glyph" opacity=".55" />
          <circle cx="249" cy="127" r="32" className="art-accent" />
          <path d="m234 127 10 10 20-22" className="art-check" />
        </>}
        {kind === 'knowledge' && <>
          <g transform="rotate(-8 111 82)"><rect x="44" y="21" width="135" height="112" rx="14" className="art-node" /><path d="M66 48h67m-67 19h90m-90 19h54" className="art-glyph" opacity=".45" /></g>
          <g transform="rotate(7 216 106)"><rect x="150" y="54" width="135" height="112" rx="14" className="art-node" /><path d="M172 82h68m-68 19h90m-90 19h54" className="art-glyph" /></g>
          <path d="m132 145 18 13 19-14" className="art-glyph" />
        </>}
      </svg>
    </div>
  );
}
