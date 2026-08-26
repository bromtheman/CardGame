import { describe, expect, it } from 'vitest'
import {
  actionForStatus, backoffDelayMs, BACKOFF_BASE_MS, BACKOFF_CAP_MS, wakeAction,
} from './reconnectPolicy'

describe('backoffDelayMs', () => {
  it('doubles from the base and caps', () => {
    expect(backoffDelayMs(0)).toBe(BACKOFF_BASE_MS)
    expect(backoffDelayMs(1)).toBe(2000)
    expect(backoffDelayMs(3)).toBe(8000)
    expect(backoffDelayMs(10)).toBe(BACKOFF_CAP_MS)
  })
})

describe('actionForStatus', () => {
  it('maps channel lifecycle statuses to hook actions', () => {
    expect(actionForStatus('SUBSCRIBED')).toBe('settled')
    expect(actionForStatus('CHANNEL_ERROR')).toBe('reconnect')
    expect(actionForStatus('TIMED_OUT')).toBe('reconnect')
    expect(actionForStatus('CLOSED')).toBe('reconnect')
    expect(actionForStatus('anything-else')).toBe('ignore')
  })
})

describe('wakeAction', () => {
  it('reconnects only when the channel is not joined', () => {
    expect(wakeAction('joined')).toBe('refetch')
    expect(wakeAction('closed')).toBe('reconnect')
    expect(wakeAction('errored')).toBe('reconnect')
    expect(wakeAction('joining')).toBe('reconnect')
  })
})
