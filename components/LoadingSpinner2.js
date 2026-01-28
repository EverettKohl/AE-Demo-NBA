import React from "react";
import clsx from "clsx";

const sizes = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-10 w-10",
};

const colors = {
  default: "border-slate-300",
  primary: "border-indigo-500",
};

const LoadingSpinner2 = ({ size = "md", color = "default" }) => {
  return (
    <div className={clsx("inline-block animate-spin rounded-full border-2 border-t-transparent", sizes[size], colors[color])} />
  );
};

export default LoadingSpinner2;
