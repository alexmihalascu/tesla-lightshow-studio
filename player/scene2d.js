// Scenă 2D: lateral (stânga mașinii), față și spate, desenate per model. Lămpile au data-lamp = chei din emulator.
const SIDE = {
  model3: {
    body: 'M78 238 C66 228 64 206 76 196 C92 186 140 176 210 168 C260 162 300 158 330 152 C380 120 430 98 490 92 C560 86 640 92 700 120 C740 138 780 146 812 152 C828 156 834 176 830 204 L824 238 L706 238 A56 56 0 0 0 594 238 L271 238 A56 56 0 0 0 159 238 Z',
    glass: 'M345 152 C390 124 435 106 490 100 C555 95 625 100 690 126 L700 134 C640 140 520 146 352 158 Z',
    fw: 'M392 150 L392 132 C420 116 455 106 512 102 L514 145 Z', rw: 'M528 144 L526 101 C580 99 625 104 664 120 L668 135 Z',
    head: 'M80 198 C96 190 130 182 160 180 L152 188 C124 190 98 196 86 202 Z',
    tail: 'M800 150 L826 158 L828 174 L806 170 Z', rturn: 'M804 153 L824 159',
    rep: [296, 194], marker: [92, 210], port: [770, 160],
    mirror: 'M372 160 C360 150 338 150 333 160 C336 169 360 171 372 167 Z', pivot: [372, 163],
    hatch: 'M704 122 C742 139 782 147 812 152 C824 156 828 166 828 172 L800 168 C770 156 735 140 704 130 Z', hinge: [704, 122], hatchAngle: -55,
    seams: 'M382 160 L378 236 M520 150 L522 236 M668 140 C680 170 692 205 694 236',
    handles: [[462, 176], [604, 172]], wheels: [[215, 250], [650, 250]], r: 42,
    beam: '82,192 82,208 -130,292 -130,212',
  },
  modelY: {
    body: 'M78 236 C66 226 64 200 78 190 C96 180 140 170 210 162 C260 156 300 150 330 144 C380 110 430 86 490 80 C560 76 650 80 712 108 C750 124 790 136 816 146 C830 152 836 176 832 204 L826 236 L706 236 A56 56 0 0 0 594 236 L271 236 A56 56 0 0 0 159 236 Z',
    glass: 'M345 144 C390 112 435 92 490 88 C560 84 645 90 705 116 L716 128 C650 134 520 140 352 150 Z',
    fw: 'M392 142 L392 122 C420 104 455 95 512 92 L514 137 Z', rw: 'M528 136 L526 91 C585 89 640 95 690 112 L696 127 Z',
    head: 'M80 192 C96 184 130 176 160 174 L152 182 C124 184 98 190 86 196 Z',
    tail: 'M806 146 L830 154 L832 170 L810 166 Z', rturn: 'M810 149 L828 155',
    rep: [296, 188], marker: [92, 204], port: [772, 154],
    mirror: 'M372 152 C360 142 338 142 333 152 C336 161 360 163 372 159 Z', pivot: [372, 155],
    hatch: 'M702 104 C742 120 788 134 816 146 C828 150 832 160 832 170 L792 168 C762 150 732 128 702 112 Z', hinge: [702, 104], hatchAngle: -60,
    seams: 'M382 152 L378 234 M520 142 L522 234 M676 128 C686 165 694 200 696 234',
    handles: [[462, 170], [604, 166]], wheels: [[215, 248], [650, 248]], r: 44,
    beam: '82,186 82,202 -130,292 -130,206',
  },
  modelS: {
    body: 'M78 238 C66 228 64 208 76 198 C92 190 140 180 210 172 C270 166 310 162 340 156 C392 124 440 104 500 98 C580 94 650 104 720 130 C760 144 795 150 820 156 C832 160 836 180 832 206 L826 238 L706 238 A56 56 0 0 0 594 238 L271 238 A56 56 0 0 0 159 238 Z',
    glass: 'M356 156 C400 128 445 112 500 106 C575 102 645 110 712 134 L720 140 C650 146 520 152 362 162 Z',
    fw: 'M400 154 L400 136 C428 120 462 112 516 108 L518 150 Z', rw: 'M532 149 L530 107 C590 106 640 112 688 128 L692 142 Z',
    head: 'M80 200 C96 194 130 186 160 184 L152 192 C124 194 98 198 86 204 Z',
    tail: 'M812 156 L830 162 L832 176 L812 172 Z', rturn: 'M814 159 L828 164',
    rep: [300, 198], marker: [92, 212], port: [780, 164],
    mirror: 'M384 164 C372 154 350 154 345 164 C348 173 372 175 384 171 Z', pivot: [384, 167],
    hatch: 'M712 132 C755 146 792 152 820 156 C830 160 832 168 832 176 L796 174 C770 160 740 144 712 138 Z', hinge: [712, 132], hatchAngle: -55,
    seams: 'M394 164 L390 236 M524 156 L526 236 M690 146 C696 175 700 205 700 236',
    handles: [[466, 180], [608, 176]], wheels: [[215, 250], [650, 250]], r: 42,
    beam: '82,194 82,210 -130,292 -130,214',
  },
  modelX: {
    body: 'M78 236 C66 226 64 198 80 188 C98 178 140 168 210 160 C262 154 300 146 326 138 C376 100 430 78 492 74 C570 70 660 74 720 100 C758 116 796 128 818 140 C832 148 836 176 832 204 L826 236 L706 236 A58 58 0 0 0 590 236 L273 236 A58 58 0 0 0 157 236 Z',
    glass: 'M342 138 C388 104 436 84 492 80 C568 76 655 82 712 106 L722 120 C650 128 520 134 348 144 Z',
    fw: 'M390 136 L390 116 C420 98 455 88 512 86 L514 131 Z', rw: 'M528 130 L526 85 C585 83 640 88 690 106 L696 121 Z',
    head: 'M80 190 C96 182 130 174 160 172 L152 180 C124 182 98 188 86 194 Z',
    tail: 'M806 140 L830 148 L832 166 L810 160 Z', rturn: 'M810 143 L828 150',
    rep: [296, 186], marker: [92, 202], port: [772, 150],
    mirror: 'M370 148 C358 138 336 138 331 148 C334 157 358 159 370 155 Z', pivot: [370, 151],
    hatch: 'M716 102 C756 118 794 130 818 140 C830 146 834 158 834 168 L796 166 C766 146 738 124 712 110 Z', hinge: [714, 102], hatchAngle: -60,
    falcon: 'M522 82 C585 78 645 84 700 106 L702 234 L524 234 Z', falconHinge: [524, 80],
    seams: 'M380 138 L376 234 M520 128 L522 234 M700 112 C706 160 708 200 706 234',
    handles: [], wheels: [[215, 248], [648, 248]], r: 46,
    beam: '82,184 82,200 -130,292 -130,204',
  },
  cybertruck: {
    body: 'M74 236 L72 192 L470 72 L842 150 L842 236 L708 236 A56 56 0 0 0 592 236 L273 236 A56 56 0 0 0 157 236 Z',
    glass: 'M330 120 L470 78 L600 105 L604 146 L334 154 Z',
    fw: 'M344 150 L344 120 L462 85 L466 146 Z', rw: 'M478 85 L592 108 L594 142 L478 145 Z',
    head: 'M73 190 L130 173 L131 177 L74 195 Z',
    tail: 'M830 148 L842 150 L842 160 L830 158 Z', rturn: 'M832 152 L840 153',
    rep: [300, 182], marker: [96, 214], port: [762, 168],
    mirror: 'M338 152 C326 144 306 144 302 152 C305 160 326 162 338 158 Z', pivot: [338, 155],
    hatch: 'M72 192 L300 123 L304 150 L76 200 Z', hinge: [302, 124], hatchAngle: 32,
    seams: 'M340 156 L338 236 M476 146 L478 236 M600 146 L602 236',
    handles: [], wheels: [[215, 250], [650, 250]], r: 44, ct: true,
    beam: '74,186 74,200 -130,292 -130,206',
  },
};
const SHAPE_FOR = { m3: 'model3', m3old: 'model3', my: 'modelY', myj: 'modelY', ms: 'modelS', mx: 'modelX', ct: 'cybertruck' };

const DEFS = `<defs>
  <linearGradient id="paint" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5f656d"/><stop offset=".45" stop-color="#34393f"/><stop offset="1" stop-color="#1a1d21"/></linearGradient>
  <linearGradient id="paintCT" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9bec4"/><stop offset=".5" stop-color="#7d838a"/><stop offset="1" stop-color="#3b3f44"/></linearGradient>
  <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26303c"/><stop offset=".5" stop-color="#0f141a"/><stop offset="1" stop-color="#060709"/></linearGradient>
  <radialGradient id="rim" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#b8c0c9"/><stop offset=".7" stop-color="#555d66"/><stop offset="1" stop-color="#26292e"/></radialGradient>
  <linearGradient id="beam" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#fffbe8" stop-opacity=".5"/><stop offset="1" stop-color="#fffbe8" stop-opacity="0"/></linearGradient>
  <radialGradient id="poolW"><stop offset="0" stop-color="#fffbe8" stop-opacity=".65"/><stop offset="1" stop-color="#fffbe8" stop-opacity="0"/></radialGradient>
  <radialGradient id="poolR"><stop offset="0" stop-color="#ff2b2b" stop-opacity=".7"/><stop offset="1" stop-color="#ff2b2b" stop-opacity="0"/></radialGradient>
  <radialGradient id="poolA"><stop offset="0" stop-color="#ffa628" stop-opacity=".65"/><stop offset="1" stop-color="#ffa628" stop-opacity="0"/></radialGradient>
  <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#101114"/><stop offset="1" stop-color="#050506"/></linearGradient>
  <filter id="bloom" x="-60%" y="-60%" width="220%" height="220%">
    <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="a"/><feGaussianBlur in="SourceGraphic" stdDeviation="9" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="a"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>`;

const lamp = (keys, attrs, color, base = 1) =>
  `<${attrs[0]} class="lamp" data-lamp="${keys}" data-base="${base}" ${attrs[1]} ${attrs[0] === 'path' && attrs[2] ? `stroke="${color}" fill="none"` : `fill="${color}"`} opacity="0"/>`;

function sideSvg(s) {
  const paint = s.ct ? 'url(#paintCT)' : 'url(#paint)';
  const win = (id, d, rgb, extra = '') => `
    <clipPath id="clip${id}"><path d="${d}"/></clipPath>
    <g clip-path="url(#clip${id})" ${extra}>
      <rect x="300" y="60" width="420" height="110" fill="#262c34"/>
      <rect class="rgb" data-rgb="${rgb}" x="300" y="60" width="420" height="110" fill="#000" opacity="0"/>
      <rect class="glass" data-closure="${id === 'FW' ? 'winLF' : 'winLR'}" x="300" y="60" width="420" height="110" fill="url(#glass)"/>
    </g>`;
  const rearWindow = win('RW', s.rw, 'lr');
  return `<svg class="v-side" viewBox="-130 40 1040 280" role="img" aria-label="Mașina din lateral">
    ${DEFS}
    <rect x="-130" y="292" width="1040" height="40" fill="url(#ground)"/>
    <ellipse cx="450" cy="294" rx="400" ry="12" fill="#000" opacity=".7"/>
    <polygon class="lamp" data-lamp="outerL,innerL" data-base="1" points="${s.beam}" fill="url(#beam)" opacity="0"/>
    <ellipse class="lamp" data-lamp="outerL,innerL" data-base="1" cx="-40" cy="294" rx="170" ry="14" fill="url(#poolW)" opacity="0"/>
    <ellipse class="lamp" data-lamp="brake,tailL,reverseL" data-base="1" cx="870" cy="294" rx="110" ry="12" fill="url(#poolR)" opacity="0"/>
    <ellipse class="lamp" data-lamp="repL,rsmL" data-base="1" cx="${s.rep[0]}" cy="294" rx="90" ry="8" fill="url(#poolA)" opacity="0"/>
    <path d="${s.body}" fill="${paint}"/>
    <path class="hatch-hole" d="${s.hatch}" fill="#07080a" opacity="0"/>
    <path d="${s.glass}" fill="url(#glass)"/>
    ${s.ct ? '' : '<path d="M160 194 C300 184 600 176 812 166" stroke="#fff" stroke-opacity=".12" stroke-width="2" fill="none"/>'}
    <path d="${s.seams}" stroke="#0008" stroke-width="1.5" fill="none"/>
    ${win('FW', s.fw, 'lf')}
    ${s.falcon ? `<g class="falcon" data-hinge="${s.falconHinge}"><path d="${s.falcon}" fill="${paint}" stroke="#0006"/>${rearWindow}</g>` : rearWindow}
    ${s.handles.map(([x, y], i) => `<rect class="handle" data-closure="${i ? 'handleLR' : 'handleLF'}" x="${x}" y="${y}" width="26" height="4" rx="2" fill="#15181c"/>`).join('')}
    <path class="hatch" d="${s.hatch}" fill="${paint}" stroke="#0007" data-hinge="${s.hinge}" data-angle="${s.hatchAngle}"/>
    ${s.wheels.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${s.r}" fill="#0a0b0d"/><circle cx="${x}" cy="${y}" r="${s.r * 0.69}" fill="url(#rim)"/>`).join('')}
    <path class="mirror" data-closure="mirrorL" data-pivot="${s.pivot}" data-mode="side" d="${s.mirror}" fill="${s.ct ? '#6d737a' : '#2f343a'}" stroke="#0008"/>
    <rect x="${s.port[0]}" y="${s.port[1]}" width="16" height="20" rx="3" fill="#0c0e11"/>
    <rect class="port-led" x="${s.port[0] + 3}" y="${s.port[1] + 4}" width="10" height="12" rx="2" fill="#3cf" opacity="0"/>
    <rect class="port-door" x="${s.port[0]}" y="${s.port[1]}" width="16" height="20" rx="3" fill="${s.ct ? '#8a9097' : '#3a3f45'}" stroke="#0007"/>
    <g filter="url(#bloom)">
      <path d="${s.head}" fill="#0e1013"/>
      ${lamp('outerL,innerL,sigL,c4L', ['path', `d="${s.head}"`], '#f4f8ff')}
      ${lamp('markerL', ['rect', `x="${s.marker[0]}" y="${s.marker[1]}" width="12" height="4" rx="2"`], '#ffa628')}
      ${lamp(s.ct ? 'repL' : 'repL', ['rect', `x="${s.rep[0]}" y="${s.rep[1]}" width="14" height="4" rx="2"`], '#ffa628')}
      <path d="${s.tail}" fill="#250a0a"/>
      ${lamp('tailL', ['path', `d="${s.tail}"`], '#ff2b2b', 0.5)}
      ${lamp('brake', ['path', `d="${s.tail}"`], '#ff2b2b')}
      ${lamp('rturnL', ['path', `d="${s.rturn}" stroke-width="3" stroke-linecap="round"`, true], '#ffa628')}
      ${s.ct ? lamp('rsmL', ['rect', `x="800" y="176" width="14" height="4" rx="2"`], '#ffa628') : ''}
    </g>
  </svg>`;
}

// Jumătatea stângă a imaginii, oglindită în JS cu cheile pereche (data-mlamp)
function frontSvg(ct) {
  if (ct) {
    const leds = Array.from({ length: 60 }, (_, i) => `<rect class="bar" data-bar="front" data-i="${59 - i}" x="${56 + i * 5.8}" y="166" width="4.6" height="5" fill="#f4f8ff" opacity="0"/>`).join('');
    return `<svg class="v-front" viewBox="0 40 460 250" role="img" aria-label="Mașina din față">
      <rect x="0" y="262" width="460" height="28" fill="url(#ground)"/>
      <ellipse class="lamp" data-lamp="outerL,outerR,innerL,innerR" data-base="1" cx="230" cy="272" rx="210" ry="16" fill="url(#poolW)" opacity="0"/>
      <rect x="70" y="212" width="40" height="56" rx="6" fill="#0a0b0d"/><rect x="350" y="212" width="40" height="56" rx="6" fill="#0a0b0d"/>
      <polygon points="40,240 46,176 230,150 414,176 420,240" fill="url(#paintCT)"/>
      <polygon points="104,152 230,96 356,152 230,140" fill="url(#glass)"/>
      <path class="mirror" data-closure="mirrorR" data-pivot="104" data-mode="front" d="M104 150 L80 146 L78 156 L104 158 Z" fill="#6d737a"/>
      <path class="mirror" data-closure="mirrorL" data-pivot="356" data-mode="front" d="M356 150 L380 146 L382 156 L356 158 Z" fill="#6d737a"/>
      <rect x="54" y="164" width="352" height="9" rx="2" fill="#16181b"/>
      <g filter="url(#bloom)">${leds}
        ${lamp('outerR,innerR', ['rect', 'x="66" y="182" width="40" height="5" rx="2"'], '#f4f8ff')}
        ${lamp('outerL,innerL', ['rect', 'x="354" y="182" width="40" height="5" rx="2"'], '#f4f8ff')}
        ${lamp('fturnR', ['rect', 'x="48" y="166" width="10" height="5" rx="2"'], '#ffa628')}
        ${lamp('fturnL', ['rect', 'x="402" y="166" width="10" height="5" rx="2"'], '#ffa628')}
        ${lamp('frunkLight', ['rect', 'x="200" y="176" width="60" height="3" rx="1.5"'], '#f4f8ff', 0.7)}
        ${Array.from({ length: 6 }, (_, i) => `<rect class="bar" data-bar="offroad" data-i="${i}" x="${150 + i * 28}" y="146" width="20" height="4" rx="2" fill="#f4f8ff" opacity="0"/>`).join('')}
      </g>
    </svg>`;
  }
  return `<svg class="v-front" viewBox="0 40 460 250" role="img" aria-label="Mașina din față">
    <rect x="0" y="262" width="460" height="28" fill="url(#ground)"/>
    <ellipse cx="230" cy="266" rx="200" ry="10" fill="#000" opacity=".7"/>
    <ellipse class="lamp" data-lamp="outerL,outerR,innerL,innerR" data-base="1" cx="230" cy="272" rx="210" ry="16" fill="url(#poolW)" opacity="0"/>
    <rect x="74" y="212" width="38" height="56" rx="9" fill="#0a0b0d"/><rect x="348" y="212" width="38" height="56" rx="9" fill="#0a0b0d"/>
    <path fill="url(#paint)" d="M52 236 C46 200 52 168 78 156 C120 142 170 136 230 136 C290 136 340 142 382 156 C408 168 414 200 408 236 C400 246 360 250 230 250 C100 250 60 246 52 236 Z"/>
    <path fill="url(#glass)" d="M108 142 C130 98 168 78 230 76 C292 78 330 98 352 142 C300 136 160 136 108 142 Z"/>
    <path d="M170 222 C200 228 260 228 290 222 L286 234 C260 238 200 238 174 234 Z" fill="#0b0c0e"/>
    <g class="half">
      <path class="mirror" data-closure="mirrorR" data-mclosure="mirrorL" data-pivot="112" data-mode="front" d="M112 132 C96 124 78 126 72 134 C75 142 96 143 112 140 Z" fill="#2f343a" stroke="#0008"/>
      <path d="M70 170 C96 160 140 158 170 164 C156 176 116 182 80 182 C72 180 68 176 70 170 Z" fill="#0a0b0d" stroke="#000a"/>
      <ellipse cx="84" cy="214" rx="11" ry="4.5" fill="#0a0b0d"/>
      <g filter="url(#bloom)">
        ${lamp('sigR', ['path', 'd="M76 170 C100 163 140 161 166 165" stroke-width="2.6" stroke-linecap="round"', true], '#f4f8ff').replace('data-lamp="sigR"', 'data-lamp="sigR" data-mlamp="sigL"')}
        ${lamp('outerR', ['circle', 'cx="88" cy="173" r="6"'], '#f4f8ff').replace('data-lamp="outerR"', 'data-lamp="outerR" data-mlamp="outerL"')}
        ${lamp('innerR', ['circle', 'cx="110" cy="172" r="6"'], '#f4f8ff').replace('data-lamp="innerR"', 'data-lamp="innerR" data-mlamp="innerL"')}
        ${lamp('c4R,c5R,c6R', ['path', 'd="M86 179 C110 179 138 176 156 170" stroke-width="2" stroke-linecap="round"', true], '#f4f8ff').replace('data-lamp="c4R,c5R,c6R"', 'data-lamp="c4R,c5R,c6R" data-mlamp="c4L,c5L,c6L"')}
        ${lamp('fturnR', ['path', 'd="M140 166 L166 165" stroke-width="3" stroke-linecap="round"', true], '#ffa628').replace('data-lamp="fturnR"', 'data-lamp="fturnR" data-mlamp="fturnL"')}
        ${lamp('fogR', ['ellipse', 'cx="84" cy="214" rx="9" ry="3.5"'], '#f4f8ff').replace('data-lamp="fogR"', 'data-lamp="fogR" data-mlamp="fogL"')}
        ${lamp('auxR,markerR', ['circle', 'cx="62" cy="188" r="3"'], '#ffa628').replace('data-lamp="auxR,markerR"', 'data-lamp="auxR,markerR" data-mlamp="auxL,markerL"')}
      </g>
    </g>
  </svg>`;
}

function rearSvg(ct) {
  if (ct) {
    const leds = Array.from({ length: 52 }, (_, i) => `<rect class="bar" data-bar="rear" data-i="${i}" x="${60 + i * 6.6}" y="160" width="5.2" height="6" fill="#ff2b2b" opacity="0"/>`).join('');
    return `<svg class="v-rear" viewBox="0 40 460 250" role="img" aria-label="Mașina din spate">
      <rect x="0" y="262" width="460" height="28" fill="url(#ground)"/>
      <ellipse class="lamp" data-lamp="brake" data-base="1" cx="230" cy="272" rx="210" ry="16" fill="url(#poolR)" opacity="0"/>
      <ellipse class="lamp" data-lamp="reverseL,reverseR,bed" data-base="1" cx="230" cy="274" rx="140" ry="10" fill="url(#poolW)" opacity="0"/>
      <rect x="70" y="212" width="40" height="56" rx="6" fill="#0a0b0d"/><rect x="350" y="212" width="40" height="56" rx="6" fill="#0a0b0d"/>
      <polygon points="40,240 46,158 230,148 414,158 420,240" fill="url(#paintCT)"/>
      <rect x="170" y="200" width="120" height="26" rx="2" fill="#c9ced4" opacity=".16"/>
      <rect x="56" y="158" width="348" height="10" rx="2" fill="#16181b"/>
      <g filter="url(#bloom)">${leds}
        ${lamp('brake', ['rect', 'x="200" y="150" width="60" height="4" rx="2"'], '#ff2b2b')}
        ${lamp('reverseL', ['rect', 'x="96" y="190" width="30" height="4" rx="2"'], '#f4f8ff')}
        ${lamp('reverseR', ['rect', 'x="334" y="190" width="30" height="4" rx="2"'], '#f4f8ff')}
        ${lamp('bed', ['rect', 'x="140" y="142" width="180" height="3" rx="1.5"'], '#f4f8ff', 0.6)}
        ${lamp('plate', ['rect', 'x="170" y="200" width="120" height="26" rx="2"'], '#f4f8ff', 0.8)}
      </g>
    </svg>`;
  }
  return `<svg class="v-rear" viewBox="0 40 460 250" role="img" aria-label="Mașina din spate">
    <rect x="0" y="262" width="460" height="28" fill="url(#ground)"/>
    <ellipse cx="230" cy="266" rx="200" ry="10" fill="#000" opacity=".7"/>
    <ellipse class="lamp" data-lamp="brake,tailL,tailR" data-base="1" cx="230" cy="272" rx="210" ry="16" fill="url(#poolR)" opacity="0"/>
    <ellipse class="lamp" data-lamp="reverseL,reverseR" data-base="1" cx="230" cy="274" rx="140" ry="10" fill="url(#poolW)" opacity="0"/>
    <rect x="74" y="212" width="38" height="56" rx="9" fill="#0a0b0d"/><rect x="348" y="212" width="38" height="56" rx="9" fill="#0a0b0d"/>
    <path fill="url(#paint)" d="M52 236 C46 200 52 168 78 156 C120 142 170 136 230 136 C290 136 340 142 382 156 C408 168 414 200 408 236 C400 246 360 250 230 250 C100 250 60 246 52 236 Z"/>
    <path fill="url(#glass)" d="M112 140 C136 100 172 84 230 82 C288 84 324 100 348 140 C300 134 160 134 112 140 Z"/>
    <path d="M150 238 C200 244 260 244 310 238" stroke="#0b0c0e" stroke-width="6" fill="none"/>
    <rect x="180" y="200" width="100" height="26" rx="3" fill="#c9ced4" opacity=".16"/>
    <g filter="url(#bloom)">${lamp('plate', ['rect', 'x="180" y="200" width="100" height="26" rx="3"'], '#f4f8ff', 0.8)}</g>
    <g class="half">
      <path d="M66 166 C90 156 150 154 196 162 L194 168 C160 168 100 172 70 178 Z" fill="#250a0a"/>
      <g filter="url(#bloom)">
        ${lamp('tailL', ['path', 'd="M66 166 C90 156 150 154 196 162 L194 168 C160 168 100 172 70 178 Z"'], '#ff2b2b', 0.5).replace('data-lamp="tailL"', 'data-lamp="tailL" data-mlamp="tailR"')}
        ${lamp('brake', ['path', 'd="M66 166 C90 156 150 154 196 162 L194 168 C160 168 100 172 70 178 Z"'], '#ff2b2b').replace('data-lamp="brake"', 'data-lamp="brake" data-mlamp="brake"')}
        ${lamp('rturnL', ['path', 'd="M72 168 C90 162 112 160 130 160" stroke-width="3" stroke-linecap="round"', true], '#ffa628').replace('data-lamp="rturnL"', 'data-lamp="rturnL" data-mlamp="rturnR"')}
        ${lamp('reverseL', ['rect', 'x="150" y="166" width="20" height="4" rx="2"'], '#f4f8ff').replace('data-lamp="reverseL"', 'data-lamp="reverseL" data-mlamp="reverseR"')}
      </g>
    </g>
    <g filter="url(#bloom)">
      ${lamp('rearFog', ['rect', 'x="96" y="226" width="24" height="5" rx="2"'], '#ff2b2b')}
      ${lamp('brake', ['path', 'd="M200 86 L260 86" stroke-width="3" stroke-linecap="round"', true], '#ff2b2b')}
    </g>
  </svg>`;
}

export function createScene2D(container, vehicleKey) {
  const s = SIDE[SHAPE_FOR[vehicleKey] || 'model3'];
  container.innerHTML = `${sideSvg(s)}<div class="pair">${frontSvg(!!s.ct)}${rearSvg(!!s.ct)}</div>`;
  for (const half of container.querySelectorAll('.half')) {
    const copy = half.cloneNode(true);
    copy.setAttribute('transform', 'translate(460 0) scale(-1 1)');
    copy.querySelectorAll('[data-mlamp]').forEach(e => e.dataset.lamp = e.dataset.mlamp);
    copy.querySelectorAll('[data-mclosure]').forEach(e => { e.dataset.closure = e.dataset.mclosure; e.dataset.pivot = 460 - e.dataset.pivot; });
    half.after(copy);
  }
  const lamps = [...container.querySelectorAll('.lamp')].map(e => ({ e, keys: e.dataset.lamp.split(','), base: +e.dataset.base || 1, last: -1 }));
  const bars = [...container.querySelectorAll('.bar')].map(e => ({ e, bar: e.dataset.bar, i: +e.dataset.i, last: -1 }));
  const rgbs = [...container.querySelectorAll('.rgb')];
  const mirrors = [...container.querySelectorAll('.mirror')];
  const glasses = [...container.querySelectorAll('.glass')];
  const handles = [...container.querySelectorAll('.handle')];
  const hatch = container.querySelector('.hatch'), hole = container.querySelector('.hatch-hole');
  const falcon = container.querySelector('.falcon');
  const portDoor = container.querySelector('.port-door'), portLed = container.querySelector('.port-led');
  const set = (o, v) => { if (o.last !== v) { o.e.setAttribute('opacity', v); o.last = v; } };

  return {
    render(out, t) {
      for (const l of lamps) {
        let v = 0;
        for (const k of l.keys) if (out[k] > v) v = out[k];
        set(l, Math.round(v * l.base * 100) / 100);
      }
      for (const b of bars) set(b, Math.round((out[b.bar === 'front' ? 'frontBar' : b.bar === 'rear' ? 'rearBar' : 'offroad'][b.i] || 0) * 100) / 100);
      for (const r of rgbs) {
        const c = out.rgb[r.dataset.rgb] || [0, 0, 0], d = out.rgb.display || [0, 0, 0];
        const mix = c.map((x, i) => Math.max(x, d[i] * 0.6));
        r.setAttribute('fill', `rgb(${mix.join(',')})`);
        r.setAttribute('opacity', (Math.max(...mix) / 255 * 0.85).toFixed(2));
      }
      const cl = out.closures;
      for (const m of mirrors) {
        const p = 1 - cl[m.dataset.closure].pos, [px, py] = m.dataset.pivot.split(',').map(Number); // cât e pliată
        m.setAttribute('transform', m.dataset.mode === 'side'
          ? `rotate(${-28 * p} ${px} ${py}) translate(${6 * p} 0)`
          : `translate(${px} 0) scale(${1 - 0.7 * p} 1) translate(${-px} 0)`);
      }
      for (const g of glasses) g.setAttribute('transform', `translate(0 ${cl[g.dataset.closure].pos * 55})`);
      for (const h of handles) h.setAttribute('fill', cl[h.dataset.closure].pos > 0.5 ? '#9aa2ab' : '#15181c');
      if (hatch) {
        const p = cl.liftgate.pos, [hx, hy] = hatch.dataset.hinge.split(',').map(Number);
        hatch.setAttribute('transform', `rotate(${hatch.dataset.angle * p} ${hx} ${hy})`);
        hole.setAttribute('opacity', p > 0.01 ? 1 : 0);
      }
      if (falcon) {
        const p = cl.falconL.pos, [hx, hy] = falcon.dataset.hinge.split(',').map(Number);
        falcon.setAttribute('transform', `rotate(${-70 * p} ${hx} ${hy})`);
      }
      const port = cl.chargePort;
      portDoor.setAttribute('transform', `translate(${18 * port.pos} 0)`);
      portLed.setAttribute('opacity', port.pos > 0.4 ? 1 : 0);
      portLed.setAttribute('fill', port.dance ? `hsl(${(t * 400) % 360} 100% 58%)` : '#3cf');
    },
  };
}
