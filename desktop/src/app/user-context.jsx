import { createContext, useContext, useEffect, useState } from "react";

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
    if (!window.api?.getCurrentUser) {
      setCurrentUser(null);
      setUserError("Current user API is not available.");
      setIsLoadingUser(false);
      return;
    }

    try {
      setIsLoadingUser(true);
      const user = await window.api.getCurrentUser();
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

