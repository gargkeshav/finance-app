# Lines starting with "#### " name the file that follows.
# ./split-prompts.sh [bundle]
awk '/^#### /{if(n)close(n);n=substr($0,6);d=n;sub(/\/[^\/]*$/,"",d);if(d!=n)system("mkdir -p \""d"\"");next}n{print>n}' "${1:-copilot-prompts35.txt}"