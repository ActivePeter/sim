/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { PromptHistoryNavigation } from '@/app/workspace/[workspaceId]/home/components/user-input/prompt-history'

describe('PromptHistoryNavigation', () => {
  it('walks native prompts backwards and forwards, then restores the unsent draft', () => {
    const navigation = new PromptHistoryNavigation()
    const history = ['first', 'second']
    let value = 'unfinished draft'
    const values = ['previous', 'previous', 'next', 'next'].map((direction) => {
      value =
        navigation.navigate(direction as 'previous' | 'next', value, history, 'chat-a') ?? value
      return value
    })
    expect(values).toEqual(['second', 'first', 'second', 'unfinished draft'])
  })

  it('preserves edits while browsing without modifying the transcript or original draft', () => {
    const navigation = new PromptHistoryNavigation()
    const history = ['first', 'second']
    navigation.navigate('previous', 'draft', history, 'chat-a')
    const previous = navigation.navigate('previous', 'edited second', history, 'chat-a')
    const next = navigation.navigate('next', previous!, history, 'chat-a')
    const draft = navigation.navigate('next', next!, history, 'chat-a')
    expect({ previous, next, draft, history }).toEqual({
      previous: 'first',
      next: 'edited second',
      draft: 'draft',
      history: ['first', 'second'],
    })
  })

  it('does not jump when a newer transcript arrives mid-navigation', () => {
    const navigation = new PromptHistoryNavigation()
    navigation.navigate('previous', '', ['first', 'second'], 'chat-a')
    const next = navigation.navigate('next', 'second', ['first', 'second', 'third'], 'chat-a')
    const newest = navigation.navigate('previous', next!, ['first', 'second', 'third'], 'chat-a')
    expect({ next, newest }).toEqual({ next: '', newest: 'third' })
  })

  it('never recalls a different chat or restores its draft after a scope switch', () => {
    const navigation = new PromptHistoryNavigation()
    navigation.navigate('previous', 'draft A', ['secret A'], 'chat-a')
    expect([
      navigation.navigate('next', 'draft B', ['prompt B'], 'chat-b'),
      navigation.navigate('previous', 'draft B', ['prompt B'], 'chat-b'),
      navigation.navigate('next', 'prompt B', ['prompt B'], 'chat-b'),
    ]).toEqual([undefined, 'prompt B', 'draft B'])
  })

  it('ignores empty prompts and leaves unhandled keys to the editor', () => {
    const navigation = new PromptHistoryNavigation()
    expect([
      navigation.navigate('next', 'draft', ['first'], 'chat-a'),
      navigation.navigate('previous', 'draft', ['', '  '], 'chat-a'),
      navigation.navigate('previous', 'draft', ['', 'first'], 'chat-a'),
      navigation.navigate('previous', 'first', ['', 'first'], 'chat-a'),
    ]).toEqual([undefined, undefined, 'first', undefined])
  })

  it('reset ends navigation after send or explicitly loading another prompt', () => {
    const navigation = new PromptHistoryNavigation()
    navigation.navigate('previous', 'draft', ['first'], 'chat-a')
    navigation.reset()
    expect(navigation.navigate('next', '', ['first'], 'chat-a')).toBeUndefined()
  })
})
