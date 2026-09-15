"use client";;
import { ActionSwapButton, ActionSwapIcon, ActionSwapText } from "./action-swap";

export function ActionSwapRollButton(props) {
  return <ActionSwapButton {...props} animation="roll" />;
}

export function ActionSwapRollText(props) {
  return <ActionSwapText {...props} animation="roll" />;
}

export function ActionSwapRollIcon(props) {
  return <ActionSwapIcon {...props} animation="roll" />;
}
