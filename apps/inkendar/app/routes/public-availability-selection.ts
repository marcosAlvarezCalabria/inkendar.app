import type {Route} from "./+types/public-availability-selection";
import {publicFreeChoiceAvailabilityHandlers} from "../free-choice-availability.server.js";

export async function action({request,params}:Route.ActionArgs){
 return publicFreeChoiceAvailabilityHandlers.action(request,params.token);
}
