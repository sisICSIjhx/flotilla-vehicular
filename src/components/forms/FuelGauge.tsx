'use client'

import { combustibleLabel } from '@/lib/constants'

interface FuelGaugeProps {
  value: number | null
  onChange?: (v: number) => void
  readonly?: boolean
  label?: string
  error?: string
}

// ── SVG constants ────────────────────────────────────────────────────────────
const CX = 150
const CY = 142
const R = 90
const START_ANGLE = 135   // SVG degrees (clockwise from 3-o'clock). This is the E position.
const TOTAL_SWEEP = 270   // degrees from E to F
const ARC_LEN = (TOTAL_SWEEP / 360) * 2 * Math.PI * R // ≈ 424.12

function pol(angleDeg: number, r: number = R) {
  const rad = (angleDeg * Math.PI) / 180
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) }
}

const E = pol(START_ANGLE)
const F = pol(START_ANGLE + TOTAL_SWEEP) // 405° = 45°

// Arc from E to F clockwise (sweep=1, large-arc=1 since 270° > 180°)
const ARC_PATH = `M ${E.x.toFixed(2)} ${E.y.toFixed(2)} A ${R} ${R} 0 1 1 ${F.x.toFixed(2)} ${F.y.toFixed(2)}`

const LEVELS = [
  { v: 0, label: 'Reserva' },
  { v: 1, label: '1/8' },
  { v: 2, label: '1/4' },
  { v: 3, label: '3/8' },
  { v: 4, label: '1/2' },
  { v: 5, label: '5/8' },
  { v: 6, label: '3/4' },
  { v: 7, label: '7/8' },
  { v: 8, label: 'Lleno' },
]

const INNER_REFS = [
  { v: 2, text: '¼' },
  { v: 4, text: '½' },
  { v: 6, text: '¾' },
]

export default function FuelGauge({ value, onChange, readonly = false, label, error }: FuelGaugeProps) {
  const safeValue = value ?? 0
  const filledLen = (safeValue / 8) * ARC_LEN
  // Needle rotates from -135° (E, v=0) to +135° (F, v=8) around (CX, CY).
  // Base needle points upward (toward 270° in SVG), so rotation = (v/8)*270 - 135.
  const needleRotation = (safeValue / 8) * TOTAL_SWEEP - (TOTAL_SWEEP / 2)
  const isSelected = value !== null
  const needleOpacity = isSelected ? 1 : 0.25

  function percentLabel(v: number): string {
    if (v === 0) return '~10% del tanque'
    return `${Math.round((v / 8) * 100)}% del tanque`
  }

  return (
    <div className="space-y-1">
      {label && <p className="text-sm font-medium text-gray-700">{label}</p>}

      <div className="bg-white rounded-2xl border border-gray-200 p-3 shadow-sm">
        <svg
          viewBox="0 0 300 235"
          className="w-full max-w-[280px] mx-auto block select-none"
          aria-label="Medidor de combustible"
        >
          {/* ── Background arc (gray) ── */}
          <path
            d={ARC_PATH}
            fill="none"
            stroke="#e5e7eb"
            strokeWidth={16}
            strokeLinecap="round"
          />

          {/* ── Red progress arc (from E to needle position) ── */}
          {isSelected && safeValue > 0 && (
            <path
              d={ARC_PATH}
              fill="none"
              stroke="#ef4444"
              strokeWidth={16}
              strokeLinecap="round"
              strokeDasharray={`${filledLen.toFixed(2)} ${(ARC_LEN + 20).toFixed(2)}`}
            />
          )}

          {/* ── Tick marks ── */}
          {LEVELS.map(({ v }) => {
            const angle = START_ANGLE + (v / 8) * TOTAL_SWEEP
            const isMain = v % 2 === 0
            const isActive = isSelected && v === safeValue
            const outer = pol(angle, R + 4)
            const inner = pol(angle, R - (isMain ? 15 : 9))
            return (
              <line
                key={v}
                x1={outer.x.toFixed(2)} y1={outer.y.toFixed(2)}
                x2={inner.x.toFixed(2)} y2={inner.y.toFixed(2)}
                stroke={isActive ? '#ef4444' : isMain ? '#6b7280' : '#9ca3af'}
                strokeWidth={isMain ? 2.5 : 1.5}
                strokeLinecap="round"
              />
            )
          })}

          {/* ── Inner fraction labels (¼ ½ ¾) ── */}
          {INNER_REFS.map(({ v, text }) => {
            const pos = pol(START_ANGLE + (v / 8) * TOTAL_SWEEP, 63)
            return (
              <text
                key={v}
                x={pos.x.toFixed(2)}
                y={pos.y.toFixed(2)}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="10"
                fill="#9ca3af"
                fontFamily="system-ui, sans-serif"
              >
                {text}
              </text>
            )
          })}

          {/* ── E / F labels ── */}
          <text
            x={(E.x - 11).toFixed(2)} y={(E.y + 17).toFixed(2)}
            textAnchor="middle" fontSize="15" fontWeight="700"
            fill="#374151" fontFamily="system-ui, sans-serif"
          >E</text>
          <text
            x={(F.x + 11).toFixed(2)} y={(F.y + 17).toFixed(2)}
            textAnchor="middle" fontSize="15" fontWeight="700"
            fill="#374151" fontFamily="system-ui, sans-serif"
          >F</text>

          {/* ── Needle group — rotates around (CX, CY) ── */}
          <g
            style={{
              transform: `rotate(${needleRotation}deg)`,
              transformOrigin: `${CX}px ${CY}px`,
              transition: 'transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)',
              opacity: needleOpacity,
            }}
          >
            {/* Tail (opposite side of needle) */}
            <line
              x1={CX} y1={CY}
              x2={CX} y2={CY + 13}
              stroke="#ef4444"
              strokeWidth={3.5}
              strokeLinecap="round"
            />
            {/* Main needle pointing upward */}
            <line
              x1={CX} y1={CY}
              x2={CX} y2={CY - 75}
              stroke="#ef4444"
              strokeWidth={3.5}
              strokeLinecap="round"
            />
          </g>

          {/* ── Center pivot ── */}
          <circle cx={CX} cy={CY} r={10} fill="#1f2937" />
          <circle cx={CX} cy={CY} r={5} fill="#ef4444" />

          {/* ── Transparent hit-areas on each tick (for tap/click) ── */}
          {!readonly && LEVELS.map(({ v }) => {
            const angle = START_ANGLE + (v / 8) * TOTAL_SWEEP
            const pos = pol(angle, R)
            return (
              <circle
                key={v}
                cx={pos.x.toFixed(2)}
                cy={pos.y.toFixed(2)}
                r={20}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onClick={() => onChange?.(v)}
                role="button"
                aria-label={`Nivel ${LEVELS[v].label}`}
              />
            )
          })}
        </svg>

        {/* ── Status + stepper ── */}
        <div className="flex items-center justify-between px-2 mt-0.5">
          {readonly ? (
            <p className="text-sm font-semibold text-gray-700 mx-auto">
              {isSelected ? combustibleLabel(safeValue) : '—'}
            </p>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onChange?.(Math.max(0, safeValue - 1))}
                className="w-10 h-10 flex items-center justify-center rounded-xl bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-700 font-bold text-xl transition-colors"
                aria-label="Reducir nivel"
              >
                −
              </button>

              <div className="text-center">
                <p className={`text-sm font-semibold ${isSelected ? 'text-gray-800' : 'text-gray-400 italic'}`}>
                  {isSelected ? combustibleLabel(safeValue) : 'Sin seleccionar'}
                </p>
                {isSelected && (
                  <p className="text-xs text-gray-400">{percentLabel(safeValue)}</p>
                )}
              </div>

              <button
                type="button"
                onClick={() => onChange?.(Math.min(8, safeValue + 1))}
                className="w-10 h-10 flex items-center justify-center rounded-xl bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-700 font-bold text-xl transition-colors"
                aria-label="Aumentar nivel"
              >
                +
              </button>
            </>
          )}
        </div>

        {/* ── Quick-select level buttons ── */}
        {!readonly && (
          <div className="flex gap-1 mt-2 justify-center flex-wrap px-1">
            {LEVELS.map(({ v, label: lbl }) => (
              <button
                key={v}
                type="button"
                onClick={() => onChange?.(v)}
                className={`px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
                  value === v
                    ? 'bg-red-500 text-white shadow-sm'
                    : 'bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-600'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-500 px-1 mt-1">{error}</p>
      )}
    </div>
  )
}
