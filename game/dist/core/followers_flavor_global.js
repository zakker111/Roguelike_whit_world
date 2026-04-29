import { logFollowerCritTaken, logFollowerCritDealt, logFollowerFlee } from "./followers_flavor.js";

if (typeof window !== "undefined") {
  window.FollowersFlavor = {
    logFollowerCritTaken,
    logFollowerCritDealt,
    logFollowerFlee,
  };
}