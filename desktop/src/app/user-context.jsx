import { createContext, useContext, useEffect, useState } from "react";
import { callIpc, IPC_CHANNELS } from "../lib/ipc-client.js";

const UserContext = createContext({
  currentUser: null,
  isLoadingUser: true,
  userError: "",
  refreshUser: async () => {}
});

export function UserProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoadingUser, setIsLoadingUser] = useState(true);
  const [userError, setUserError] = useState("");

  async function refreshUser() {
    if (!window.api?.invoke) {
      setCurrentUser(null);
      setUserError("Current user API is not available.");
      setIsLoadingUser(false);
      return;
    }

    try {
      setIsLoadingUser(true);
      const user = await callIpc(IPC_CHANNELS.AUTH_GET_CURRENT_USER);
      setCurrentUser(user);
      setUserError("");
    } catch (error) {
      setCurrentUser(null);
      setUserError(error.message ?? "Failed to load current user.");
    } finally {
      setIsLoadingUser(false);
    }
  }

  useEffect(() => {
    void refreshUser();
  }, []);

  return (
    <UserContext.Provider value={{ currentUser, isLoadingUser, userError, refreshUser }}>
      {children}
    </UserContext.Provider>
  );
}

export function useCurrentUser() {
  return useContext(UserContext);
}
