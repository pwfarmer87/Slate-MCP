# Slate MCP Server

An MCP (Model Context Protocol) server that connects [Technolutions Slate](https://technolutions.com/slate) with Claude, enabling you to query and analyze student enrollment demographics data through natural language.

## Features

- **Enrollment Demographics**: Get comprehensive demographic summaries for incoming classes
- **Diversity Metrics**: Calculate diversity indices, URM percentages, and geographic diversity
- **Enrollment Funnel**: Track conversion rates from prospect to enrolled
- **Year-over-Year Comparisons**: Analyze trends across multiple enrollment years
- **Flexible Queries**: Search and filter students by various criteria

## Prerequisites

- Node.js 18.0.0 or higher
- Access to a Technolutions Slate instance with API credentials
- Slate queries configured for enrollment data (see [Slate Configuration](#slate-configuration))

## Installation

```bash
# Clone the repository
git clone https://github.com/your-org/slate-mcp-server.git
cd slate-mcp-server

# Install dependencies
npm install

# Build the project
npm run build
```

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and configure your Slate credentials:

```bash
cp .env.example .env
```

Required environment variables:

| Variable | Description |
|----------|-------------|
| `SLATE_BASE_URL` | Your Slate instance URL (e.g., `https://yourschool.technolutions.net`) |
| `SLATE_USERNAME` | Slate API username |
| `SLATE_PASSWORD` | Slate API password |
| `SLATE_API_KEY` | (Optional) API key if your instance uses key-based auth |

### Claude Desktop Configuration

Add the server to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "slate": {
      "command": "node",
      "args": ["/path/to/slate-mcp-server/dist/index.js"],
      "env": {
        "SLATE_BASE_URL": "https://yourschool.technolutions.net",
        "SLATE_USERNAME": "your_username",
        "SLATE_PASSWORD": "your_password"
      }
    }
  }
}
```

## Slate Configuration

This MCP server expects certain queries to be configured in your Slate instance. Work with your Slate administrator to create these queries:

### Required Queries

1. **`enrollment_demographics`**: Returns enrolled student data with demographics
   - Required fields: `id`, `first_name`, `last_name`, `email`, `gender`, `ethnicity`, `race`, `citizenship`, `first_generation`, `state`, `country`, `intended_major`, `entry_year`, `entry_term`, `enrollment_status`

2. **`enrollment_funnel`**: Returns funnel counts
   - Required fields: `prospects`, `inquiries`, `applicants`, `admitted`, `deposited`, `enrolled`

3. **`students_by_status`**: Returns students filtered by application status
   - Required fields: Same as `enrollment_demographics`

### Query Parameters

The server will pass these parameters to your queries:
- `entry_year`: The enrollment year (e.g., 2024)
- `entry_term`: The enrollment term (e.g., "Fall")
- `application_status`: For status-based queries

## Available Tools

### `get_enrollment_demographics`

Get a comprehensive demographics summary for enrolled students.

**Parameters:**
- `entry_year` (required): The entry year (e.g., 2024)
- `entry_term` (optional): The entry term (default: "Fall")

**Example prompt:** "Show me the demographics for Fall 2024 incoming class"

### `get_diversity_metrics`

Get detailed diversity metrics including diversity index and URM percentages.

**Parameters:**
- `entry_year` (required): The entry year
- `entry_term` (optional): The entry term

**Example prompt:** "What are the diversity metrics for our 2024 freshman class?"

### `get_enrollment_funnel`

Get enrollment funnel data with conversion rates.

**Parameters:**
- `entry_year` (required): The entry year
- `entry_term` (optional): The entry term

**Example prompt:** "Show me the enrollment funnel and yield rates for Fall 2024"

### `compare_enrollment_years`

Compare demographics across multiple years.

**Parameters:**
- `years` (required): Array of years to compare (e.g., [2022, 2023, 2024])
- `entry_term` (optional): The entry term

**Example prompt:** "Compare enrollment demographics from 2022 to 2024"

### `get_demographics_report`

Generate a formatted, readable demographics report.

**Parameters:**
- `entry_year` (required): The entry year
- `entry_term` (optional): The entry term

**Example prompt:** "Generate a demographics report for Fall 2024"

### `get_demographics_by_category`

Get enrollment breakdown by a specific category.

**Parameters:**
- `entry_year` (required): The entry year
- `category` (required): One of: `gender`, `ethnicity`, `state`, `country`, `admit_type`, `major`, `college`, `first_generation`, `international`
- `entry_term` (optional): The entry term

**Example prompt:** "Show me enrollment by state for Fall 2024"

### `search_students`

Search for students matching specific criteria.

**Parameters:**
- `entry_year` (optional): Filter by entry year
- `entry_term` (optional): Filter by entry term
- `state` (optional): Filter by home state
- `country` (optional): Filter by home country
- `major` (optional): Filter by intended major
- `first_generation` (optional): Filter by first-gen status
- `international` (optional): Filter by international status
- `limit` (optional): Max results (default: 100)

**Example prompt:** "Find all first-generation students from California in Fall 2024"

## Example Conversations

### Getting Annual Demographics Report

```
User: What does our incoming Fall 2024 class look like demographically?

Claude: I'll pull the enrollment demographics for Fall 2024...
[Uses get_enrollment_demographics tool]

Here's a summary of your Fall 2024 incoming class:
- Total Enrolled: 2,450 students
- Gender: 54% Female, 45% Male, 1% Non-binary
- First Generation: 28% (686 students)
- International: 12% (294 students)
...
```

### Year-over-Year Analysis

```
User: How has our diversity changed over the past 3 years?

Claude: I'll compare the demographics across 2022, 2023, and 2024...
[Uses compare_enrollment_years tool]

Here's the year-over-year comparison:
- First Generation: 24% → 26% → 28% (+4 points)
- International: 10% → 11% → 12% (+2 points)
- URM: 22% → 24% → 26% (+4 points)
...
```

## Development

```bash
# Run in development mode
npm run dev

# Type check
npm run typecheck

# Lint
npm run lint

# Build
npm run build
```

## Security Considerations

- Never commit `.env` files containing credentials
- Use read-only API credentials when possible
- The server anonymizes personally identifiable information in search results
- Consider implementing rate limiting for production use

## License

MIT

## Support

For issues with this MCP server, please open a GitHub issue.

For Slate-specific questions, contact [Technolutions Support](https://technolutions.com/support).
