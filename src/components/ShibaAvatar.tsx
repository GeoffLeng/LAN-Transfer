import React from 'react'

interface ShibaAvatarProps {
  index: number
  className?: string
  size?: number
}

// 16x16 Pixel Grid Template for the Shiba Inu Face
const GRID = [
  "................",
  "................",
  "..ooo......ooo..",
  ".opppo....opppo.",
  ".ooooo....ooooo.",
  ".oooooooooooooo.",
  "oootooootooootoo",
  "ootooboooootoobo",
  "otttwwwwwwwwwtto",
  "owwwwwbbbbwwwwwo",
  "owwwwwppppwwwwwo",
  ".wwwwwwwwwwwwww.",
  "..oooooooooooo..",
  "...oooooooooo...",
  "....oooooooo....",
  "................"
]

export const ShibaAvatar: React.FC<ShibaAvatarProps> = ({ index, className = '', size = 48 }) => {
  // Select coat configuration
  const avatarIndex = index % 6

  // Base colors
  let mainColor = '#E28743'      // Red Shiba (Orange)
  let pinkColor = '#FFB7B2'
  let blackColor = '#222222'
  let whiteColor = '#FFFFFF'
  let tanColor = '#E9965A'        // Eyebrow/Cheek Tan Points

  if (avatarIndex === 1) {
    // Black & Tan Shiba
    mainColor = '#2B2D42'
    tanColor = '#E28743'
  } else if (avatarIndex === 2) {
    // Sesame Shiba (Greyish Brown)
    mainColor = '#8E6F57'
    tanColor = '#CFA483'
  } else if (avatarIndex === 3) {
    // Cream Shiba
    mainColor = '#FDF8F0'
    tanColor = '#FFFFFF'
    pinkColor = '#FFC6C4'
  }

  // Accessories override logic
  const isSunglasses = avatarIndex === 4
  const isBandana = avatarIndex === 5

  const getPixelColor = (char: string, r: number, c: number): string | null => {
    // Bandana override (Rows 12-14)
    if (isBandana && r >= 12 && r <= 14) {
      if (char === 'o') {
        // Red bandana cloth
        if ((r + c) % 3 === 0) return '#FFD166' // Yellow dots
        return '#EF233C'                       // Red base
      }
    }

    // Sunglasses override (Row 6-7 near the eyes)
    if (isSunglasses) {
      // Draw sunglasses bar and lenses
      // Row 6: columns 3 to 12
      if (r === 6 && c >= 3 && c <= 12) {
        return '#000000'
      }
      // Row 7: columns 4-5 and 10-11 (lenses)
      if (r === 7 && ((c >= 4 && c <= 5) || (c >= 10 && c <= 11))) {
        return '#000000'
      }
      // Lens shine
      if (r === 7 && (c === 4 || c === 10)) {
        return '#FFFFFF'
      }
    }

    switch (char) {
      case 'o': return mainColor
      case 'p': return pinkColor
      case 'b': return blackColor
      case 'w': return whiteColor
      case 't': return tanColor
      default: return null
    }
  }

  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={`select-none ${className}`}
      style={{ imageRendering: 'pixelated' }}
    >
      {GRID.map((row, r) =>
        row.split('').map((char, c) => {
          const color = getPixelColor(char, r, c)
          if (!color) return null
          return (
            <rect
              key={`${r}-${c}`}
              x={c}
              y={r}
              width={1}
              height={1}
              fill={color}
              shapeRendering="crispEdges"
            />
          )
        })
      )}
    </svg>
  )
}
