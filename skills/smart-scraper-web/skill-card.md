## Description: <br>
Extract structured data from websites, including tables, lists, prices, articles, metadata, and parsed HTML with local caching. <br>

This skill is ready for commercial/non-commercial use. <br>

## Publisher: <br>
[jlacroix82](https://clawhub.ai/user/jlacroix82) <br>

### License/Terms of Use: <br>
MIT-0 <br>


## Use Case: <br>
Developers and agents use this skill to fetch public web pages or parse provided HTML and convert common page structures into reusable structured data. It is suited for non-sensitive public websites where local caching of fetched content is acceptable. <br>

### Deployment Geography for Use: <br>
Global <br>

## Known Risks and Mitigations: <br>
Risk: The skill makes outbound network requests to user-provided URLs and may fetch unsafe or sensitive targets if used carelessly. <br>
Mitigation: Use only public, non-sensitive URLs and avoid internal, authenticated, sensitive, or attacker-supplied URLs. <br>
Risk: Fetched page contents and URLs may be stored in a local workspace cache. <br>
Mitigation: Clear memory/scraper-cache/cache.json after use when scraped content or URLs may be sensitive. <br>
Risk: The authoritative security verdict is suspicious because security and caching claims do not fully match artifact evidence. <br>
Mitigation: Review the artifact and security guidance before installation or execution. <br>


## Reference(s): <br>
- [ClawHub Skill Page](https://clawhub.ai/jlacroix82/smart-scraper-web) <br>
- [Artifact Skill Definition](artifact/SKILL.md) <br>
- [Artifact Security Audit](artifact/AUDIT.md) <br>


## Skill Output: <br>
**Output Type(s):** [Text, Markdown, Code, Shell commands, Configuration, Guidance] <br>
**Output Format:** [Markdown guidance with Node.js command examples and structured scraper output.] <br>
**Output Parameters:** [1D] <br>
**Other Properties Related to Output:** [Can write fetched page data to a local workspace cache.] <br>

## Skill Version(s): <br>
1.0.2 (source: server release metadata) <br>

## Ethical Considerations: <br>
Users should evaluate whether this skill is appropriate for their environment, review any generated or modified files before relying on them, and apply their organization's safety, security, and compliance requirements before deployment. <br>
