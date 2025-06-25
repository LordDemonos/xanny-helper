# Discord Raid & Event Management Bot

Welcome to the **Discord Raid & Event Management Bot**! This project is a robust, purpose-built solution for managing raid schedules, offnight events, inventory, and suggestions for our gaming community—especially those running large-scale events in games like EverQuest.

---

## 🌟 What Does This Bot Do?

- **Syncs Raid Schedules:** Reads raid schedules from Discord, keeps them up-to-date, and syncs them to Google Calendar for easy access.
- **Manages Offnight Events:** Tracks offnight (non-raid) events, syncing them to the calendar and cleaning up when Discord threads are archived or deleted.
- **Inventory Management:** Handles inventory files and updates, making it easy to track shared resources.
- **Suggestion Handling:** Integrates with Google Sheets to collect and process suggestions from your community.
- **GitHub Integration:** Automatically updates files in a GitHub repository for version control and transparency.
- **Secure & Production-Ready:** Designed for unattended operation, with strong security and logging best practices.
- **Docker/Unraid Compatible:** Runs reliably in modern containerized environments.

---

## 🚀 Why This Project Matters

Running a gaming community is hard work! We built this bot to automate the tedious parts—so you can focus on having fun and building your community. Every feature is designed to:
- **Save you time**
- **Reduce mistakes**
- **Keep everyone in the loop**
- **Protect your data and privacy**

This project represents many hours of careful engineering, security review, and real-world testing. We hope it makes your community management easier and more enjoyable!

---

## 🛠️ Features At a Glance

- **Automatic Discord-to-Calendar Sync**
- **Handles both official raid nights and offnight events**
- **Cleans up calendar events when Discord threads are archived**
- **Inventory file management and caching**
- **Suggestion box with Google Sheets integration**
- **Concise, secure logging (no sensitive data ever logged)**
- **Easy configuration for our environment**
- **Works out-of-the-box with Docker and Unraid**

---

## 📦 How We Use It

This bot is tailored for our community's unique needs. It is not intended for general public use or as a plug-and-play solution. The configuration, credentials, and channel IDs are all specific to our setup. If you're reading this out of curiosity or for inspiration, welcome! But please note that this project is highly customized and not supported as a general-purpose tool.

---

## 🔒 Security & Privacy

- **No sensitive data is ever logged.**
- Credentials are read-only inside the container.
- All API keys and secrets are kept out of the codebase and only loaded at runtime.
- The bot is designed to run unattended and securely in production.

---

## 🧑‍💻 For Developers & Curious Readers

- Written in TypeScript for safety and maintainability
- Follows best practices for code quality, error handling, and logging
- Modular structure for easy extension
- See the `src/` directory for all main logic

---

## 🤝 Support & Contributions

- **Questions?** Open an issue on GitHub or ask in your Discord community.
- **Found a bug?** Please report it with as much detail as possible.
- **Want to contribute?** PRs are welcome! Please follow the code style and add tests if possible.

---

## 🙏 Acknowledgements

This project is the result of many hours of work by passionate gamers and engineers who wanted to make community management easier for everyone. Thank you for using it, and we hope it helps your guild or group thrive!

---

**Happy Raiding!** 🎉 