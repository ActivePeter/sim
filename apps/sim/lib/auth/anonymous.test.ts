/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const updateWhere = vi.fn().mockResolvedValue([])
  const updateSet = vi.fn(() => ({ where: updateWhere }))
  return {
    findUser: vi.fn(),
    findUserStats: vi.fn(),
    update: vi.fn(() => ({ set: updateSet })),
    updateSet,
    updateWhere,
  }
})

vi.mock('@sim/db', () => ({
  db: {
    query: {
      user: { findFirst: mocks.findUser },
      userStats: { findFirst: mocks.findUserStats },
    },
    update: mocks.update,
  },
}))

import { ensureAnonymousUserExists } from '@/lib/auth/anonymous'
import { ANONYMOUS_USER } from '@/lib/auth/constants'

describe('anonymous auth bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findUser.mockResolvedValue({
      ...ANONYMOUS_USER,
      email: 'anonymous@localhost',
    })
    mocks.findUserStats.mockResolvedValue({ id: 'stats-1' })
  })

  it('repairs a legacy anonymous email so public API schemas can project it', async () => {
    await ensureAnonymousUserExists()

    expect(mocks.updateSet).toHaveBeenCalledWith({
      email: 'anonymous@localhost.invalid',
      updatedAt: expect.any(Date),
    })
    expect(mocks.updateWhere).toHaveBeenCalledOnce()
  })
})
