import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import AskOncePage from "./Pages/AskOncePage.jsx";
import ChatPage from "./Pages/ChatPage.jsx";
import Layout from "./Layout.jsx";
import "./index.css";

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <AskOncePage /> },     
      { path: "/ask", element: <AskOncePage /> },
      { path: "/chat", element: <ChatPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);

