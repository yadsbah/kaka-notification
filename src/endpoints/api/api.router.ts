import Elysia from "elysia";
import apiNotificationsRouter from "./notifications/notifications.router";

const apiRouter = new Elysia({
  tags: ["API"],
}).group("/v1", (app) => app.use(apiNotificationsRouter));

export default apiRouter;
