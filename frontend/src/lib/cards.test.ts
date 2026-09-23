import { describe, expect, it, vi } from 'vitest'
import { VEHICLE_TYPES } from '@shared/gameSettings'
import { cardImageOrFallback, type CardRow } from './cards'
import { vehicleTypeIcon } from './keywords'
import anchorArt from '../assets/icons/anchorSVG.svg'

// cards.ts imports supabaseClient for its query hook, and that module throws at
// import time without the Vite env vars (see games.test.ts). cardImageOrFallback
// is pure, so a stub client is enough.
vi.mock('./supabaseClient', () => ({ supabase: {} }))

const card = (vehicle_type: string | null, image_url = 'Volta.png') => ({ vehicle_type, image_url }) as CardRow

describe('cardImageOrFallback', () => {
  // Owner ruling, 2026-09-22: a card with no hosted art keeps the faded type
  // silhouette as its picture. The gold emblems are the small UI icons (board
  // chip, details list) and must not become every built-in card's artwork.
  it('pictures a card with no hosted art by its type placeholder, not its UI icon', () => {
    for (const type of Object.values(VEHICLE_TYPES)) {
      const img = cardImageOrFallback(card(type))
      expect(img.isFallback).toBe(true)
      expect(img.src, `${type} placeholder`).not.toBe(vehicleTypeIcon(type))
    }
  })

  // A type with no PLACEHOLDER_ART entry falls back to the ability's anchor
  // without any error — the hovercraft did when the pictures split from the
  // icons (2026-09-22) — so every type the engine knows must have a silhouette
  // of its own, and a type added to VEHICLE_TYPES without one fails here.
  it('pictures every vehicle type by a silhouette of its own, never the anchor', () => {
    expect(cardImageOrFallback(card('no-such-type')).src, 'an unknown type falls back to the anchor').toBe(anchorArt)
    for (const type of Object.values(VEHICLE_TYPES)) {
      expect(cardImageOrFallback(card(type)).src, `a ${type} card is pictured by the anchor`).not.toBe(anchorArt)
    }
  })

  it('still gives an ability (no vehicle type) a placeholder picture', () => {
    const img = cardImageOrFallback(card(null))
    expect(img.isFallback).toBe(true)
    expect(img.src).toMatch(/\S/)
  })

  it('shows hosted art as it is', () => {
    expect(cardImageOrFallback(card(VEHICLE_TYPES.SHIP, 'https://example.com/volta.png')))
      .toEqual({ src: 'https://example.com/volta.png', isFallback: false })
  })
})
