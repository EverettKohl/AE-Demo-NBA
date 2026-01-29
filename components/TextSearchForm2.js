import React from "react";

/**
 * SearchBar2 -> TextSearchForm2
 */
const TextSearchForm2 = ({ handleTextFormSubmit, inputRef }) => {
  return (
    <form className="flex-grow flex items-center min-w-0" onSubmit={handleTextFormSubmit}>
      <input
        className="text-slate-100 text-base md:text-lg placeholder:text-slate-500 leading-relaxed w-full bg-transparent border-none focus:outline-none focus:ring-0"
        ref={inputRef}
        placeholder="Search Kill Bill: The Whole Bloody Affair using natural language..."
      />
    </form>
  );
};

export default TextSearchForm2;
