import { setup, assign } from 'xstate'
import { handleSessionEvent } from '../handlers/session'
import { handleMessageEvent } from '../handlers/message'
import { handlePartEvent } from '../handlers/part'
import { handlePermissionEvent } from '../handlers/permission'
import type { SetStoreFunction } from 'solid-js/store'
export type ChatMachineContext = {
    store: any
    setStore: SetStoreFunction<any>
    sessionStates: Record<string, 'idle' | 'user_typing' | 'sending' | 'generating' | 'waiting_permission'>
}

export type ChatMachineEvent = { type: string; payload: any }

export const chatMachine = setup({
    types: {
        context: {} as ChatMachineContext,
        events: {} as ChatMachineEvent,
        input: {} as { store: any; setStore: SetStoreFunction<any> },
    },
    actions: {
        applySolidStoreMutations: ({ context, event }) => {
            const { type, payload } = event
            if (type.startsWith('session.')) {
                handleSessionEvent(payload, context.store, context.setStore)
            } else if (type.startsWith('message.part.')) {
                handlePartEvent(payload, context.store, context.setStore)
            } else if (type.startsWith('message.')) {
                handleMessageEvent(payload, context.store, context.setStore)
            } else if (type.startsWith('permission.') || type.startsWith('question.')) {
                handlePermissionEvent(payload, context.store, context.setStore)
            }
        },
        updateLifecycleState: assign({
            sessionStates: ({ context, event }) => {
                const { type, payload } = event
                const sessionID =
                    payload.properties?.sessionID ||
                    payload.properties?.info?.sessionID ||
                    payload.properties?.part?.messageID // Using part's messageID somewhat as fallback if sessionID is omitted

                if (!sessionID) return context.sessionStates

                let newState = context.sessionStates[sessionID] || 'idle'

                if (type === 'message.updated' && payload.properties?.info?.role === 'assistant') {
                    newState = 'generating'
                } else if (type === 'message.part.updated') {
                    newState = 'generating'
                } else if (type === 'permission.asked' || type === 'question.asked') {
                    newState = 'waiting_permission'
                } else if (type === 'permission.replied' || type === 'question.replied') {
                    newState = 'generating' // assumes it goes back to generating after permission
                }

                return {
                    ...context.sessionStates,
                    [sessionID]: newState,
                }
            },
        }),
    },
}).createMachine({
    id: 'chatMachine',
    initial: 'idle',
    context: ({ input }) => ({
        store: input.store,
        setStore: input.setStore,
        sessionStates: {},
    }),
    states: {
        idle: {
            on: {
                '*': {
                    target: 'idle',
                    actions: ['applySolidStoreMutations', 'updateLifecycleState'],
                },
            },
        },
    },
})
