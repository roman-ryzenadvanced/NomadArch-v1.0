import { sessions, withSession } from "./session-state"
import { Task, TaskStatus } from "../types/session"
import { nanoid } from "nanoid"
import { createSession } from "./session-api"
import { showToastNotification } from "../lib/notifications"

export function setActiveTask(instanceId: string, sessionId: string, taskId: string | undefined): void {
  withSession(instanceId, sessionId, (session) => {
    session.activeTaskId = taskId
  })
}

export async function addTask(
  instanceId: string, 
  sessionId: string, 
  title: string
): Promise<{ id: string; taskSessionId?: string }> {
  const id = nanoid()
  // console.log("[task-actions] addTask started", { instanceId, sessionId, title, taskId: id });
  
  let taskSessionId: string | undefined
  const parentSession = sessions().get(instanceId)?.get(sessionId)
  const parentAgent = parentSession?.agent || ""
  const parentModel = parentSession?.model
  try {
    // console.log("[task-actions] creating new task session...");
    const created = await createSession(instanceId, parentAgent || undefined, { skipAutoCleanup: true })
    taskSessionId = created.id
    withSession(instanceId, taskSessionId, (taskSession) => {
      taskSession.parentId = sessionId
      if (parentAgent) {
        taskSession.agent = parentAgent
      }
      if (parentModel?.providerId && parentModel?.modelId) {
        taskSession.model = { ...parentModel }
      }
    })
    // console.log("[task-actions] task session created", { taskSessionId });
  } catch (error) {
    console.error("[task-actions] Failed to create session for task", error)
    showToastNotification({
      title: "Task session unavailable",
      message: "Continuing in the current session.",
      variant: "warning",
      duration: 5000,
    })
    taskSessionId = undefined
  }

  const newTask: Task = {
    id,
    title,
    status: "pending",
    timestamp: Date.now(),
    messageIds: [],
    taskSessionId,
    archived: false,
  }

  withSession(instanceId, sessionId, (session) => {
    if (!session.tasks) {
      session.tasks = []
    }
    session.tasks = [newTask, ...session.tasks]
    // console.log("[task-actions] task added to session", { taskCount: session.tasks.length });
  })

  return { id, taskSessionId }
}

export function addTaskMessage(
  instanceId: string,
  sessionId: string,
  taskId: string,
  messageId: string,
): void {
  // console.log("[task-actions] addTaskMessage called", { instanceId, sessionId, taskId, messageId });
  withSession(instanceId, sessionId, (session) => {
    let targetSessionId = sessionId
    let targetTaskId = taskId

    // If this is a child session, the tasks are on the parent
    if (session.parentId && !session.tasks) {
      targetSessionId = session.parentId
      // console.log("[task-actions] task session detected, targeting parent", { parentId: session.parentId });
    }

    withSession(instanceId, targetSessionId, (targetSession) => {
      if (!targetSession.tasks) {
        console.warn("[task-actions] target session has no tasks array", { targetSessionId });
        return
      }
      
      const taskIndex = targetSession.tasks.findIndex((t) => t.id === targetTaskId || t.taskSessionId === sessionId)
      if (taskIndex !== -1) {
        const task = targetSession.tasks[taskIndex]
        const messageIds = [...(task.messageIds || [])]
        
        if (!messageIds.includes(messageId)) {
          messageIds.push(messageId)
          
          // Replace the task object and the tasks array to trigger reactivity
          const updatedTask = { ...task, messageIds }
          const updatedTasks = [...targetSession.tasks]
          updatedTasks[taskIndex] = updatedTask
          targetSession.tasks = updatedTasks
          
          // console.log("[task-actions] message ID added to task with reactivity", { taskId: task.id, messageCount: messageIds.length });
        } else {
          // console.log("[task-actions] message ID already in task", { taskId: task.id });
        }
      } else {
        console.warn("[task-actions] task not found in session", { targetTaskId, sessionId, availableTaskCount: targetSession.tasks.length });
      }
    })
  })
}

export function replaceTaskMessageId(
  instanceId: string,
  sessionId: string,
  oldMessageId: string,
  newMessageId: string,
): void {
  withSession(instanceId, sessionId, (session) => {
    let targetSessionId = sessionId

    if (session.parentId && !session.tasks) {
      targetSessionId = session.parentId
    }

    withSession(instanceId, targetSessionId, (targetSession) => {
      if (!targetSession.tasks) return

      const taskIndex = targetSession.tasks.findIndex((t) => 
        t.messageIds?.includes(oldMessageId) || t.taskSessionId === sessionId
      )

      if (taskIndex !== -1) {
        const task = targetSession.tasks[taskIndex]
        const messageIds = [...(task.messageIds || [])]
        const index = messageIds.indexOf(oldMessageId)
        
        let changed = false
        if (index !== -1) {
          messageIds[index] = newMessageId
          changed = true
        } else if (task.taskSessionId === sessionId && !messageIds.includes(newMessageId)) {
          messageIds.push(newMessageId)
          changed = true
        }

        if (changed) {
          const updatedTask = { ...task, messageIds }
          const updatedTasks = [...targetSession.tasks]
          updatedTasks[taskIndex] = updatedTask
          targetSession.tasks = updatedTasks
        }
      }
    })
  })
}

export function updateTaskStatus(
  instanceId: string,
  sessionId: string,
  taskId: string,
  status: TaskStatus,
): void {
  withSession(instanceId, sessionId, (session) => {
    if (!session.tasks) return
    session.tasks = session.tasks.map((t) => (t.id === taskId ? { ...t, status } : t))
  })
}

export function removeTask(instanceId: string, sessionId: string, taskId: string): void {
  withSession(instanceId, sessionId, (session) => {
    if (!session.tasks) return
    session.tasks = session.tasks.filter((t) => t.id !== taskId)
    if (session.activeTaskId === taskId) {
      session.activeTaskId = undefined
    }
  })
}

export function archiveTask(instanceId: string, sessionId: string, taskId: string): void {
  withSession(instanceId, sessionId, (session) => {
    if (!session.tasks) return
    session.tasks = session.tasks.map((task) =>
      task.id === taskId ? { ...task, archived: true } : task,
    )
    if (session.activeTaskId === taskId) {
      session.activeTaskId = undefined
    }
  })
}
