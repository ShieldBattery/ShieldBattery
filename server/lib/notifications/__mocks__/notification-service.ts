const retrieveNotifications = jest.fn().mockResolvedValue([])
const addNotification = jest.fn().mockResolvedValue(undefined)
const clearBefore = jest.fn().mockResolvedValue(undefined)
const clearById = jest.fn().mockResolvedValue(undefined)
const markRead = jest.fn().mockResolvedValue(undefined)

const mockNotificationService = jest.fn().mockImplementation(() => {
  return {
    retrieveNotifications,
    addNotification,
    clearBefore,
    clearById,
    markRead,
  }
})

export default mockNotificationService
