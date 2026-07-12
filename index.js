import express from "express";
import fs from "fs";
import dotenv from "dotenv";
import { App } from "@octokit/app";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const server = express();

server.use(
    express.json({
        limit: "20mb"
    })
);


// =======================
// GitHub App Config
// =======================

const githubApp = new App({
    appId: process.env.GITHUB_APP_ID,

    privateKey: fs.readFileSync(
        process.env.GITHUB_PRIVATE_KEY_PATH,
        "utf8"
    )
});


// =======================
// Gemini Config
// =======================

const genAI = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});



// =======================
// Gemini Review Function
// =======================

async function reviewCode(diff) {

    const prompt = `
You are a senior software engineer doing a Pull Request review.

Analyze the following git diff.

Review for:
- Bugs
- Security vulnerabilities
- Performance issues
- Memory leaks
- Race conditions
- Bad coding practices
- Missing error handling
- Code maintainability

Give useful comments only.
Do not explain obvious changes.

Return review in markdown.

PR DIFF:

${diff}
`;


    const response =
        await genAI.models.generateContent({
            model: "gemini-2.5-flash",

            contents: prompt
        });


    return response.text;
}





// =======================
// GitHub Webhook
// =======================

server.post(
    "/github/webhook",

    async (req, res) => {

        try {

            const event =
                req.headers["x-github-event"];


            console.log(
                "GitHub Event:",
                event
            );


            if (event !== "pull_request") {

                return res.json({
                    message:
                        "Ignored event"
                });
            }



            const payload = req.body;



            // Only run on new PR or new commits

            if (
                payload.action !== "opened" &&
                payload.action !== "synchronize"
            ) {

                return res.json({
                    message:
                        "Ignored PR action"
                });
            }



            const installationId =
                payload.installation.id;


            const owner =
                payload.repository.owner.login;


            const repo =
                payload.repository.name;


            const pullNumber =
                payload.pull_request.number;



            console.log(
                "Reviewing:",
                {
                    owner,
                    repo,
                    pullNumber
                }
            );



            // =======================
            // Authenticate GitHub App
            // =======================


            const octokit =
                await githubApp
                    .getInstallationOctokit(
                        installationId
                    );




            // =======================
            // Get PR Diff
            // =======================


            const files =
                await octokit.request(

                    "GET /repos/{owner}/{repo}/pulls/{pull_number}/files",

                    {
                        owner,

                        repo,

                        pull_number:
                            pullNumber
                    }

                );




            let completeDiff = "";



            for (const file of files.data) {


                completeDiff += `

=================================

FILE:
${file.filename}


STATUS:
${file.status}


PATCH:

${file.patch}

`;

            }




            if (!completeDiff.trim()) {


                return res.json({
                    message:
                        "No diff found"
                });

            }




            console.log(
                "Sending diff to Gemini..."
            );




            // =======================
            // AI Review
            // =======================


            const aiReview =
                await reviewCode(
                    completeDiff
                );



            console.log(
                "AI Review Completed"
            );





            // =======================
            // Post Comment on PR
            // =======================


            await octokit.request(

                "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",

                {

                    owner,

                    repo,


                    issue_number:
                        pullNumber,


                    body:
                        `
## 🤖 AI Pull Request Review


${aiReview}
`

                }

            );



            console.log(
                "Comment added to PR"
            );




            return res.json({

                status:
                    "Review completed",

                filesReviewed:
                    files.data.length

            });



        } catch (error) {


            console.error(
                error
            );


            return res
                .status(500)
                .json({

                    error:
                        error.message

                });

        }

    }

);




// =======================
// Health Check
// =======================


server.get(
    "/",

    (req, res) => {

        res.send(
            "GitHub AI Reviewer Running 🚀"
        );

    }
);





// =======================
// Start Server
// =======================


server.listen(

    process.env.PORT || 3000,

    () => {

        console.log(
            `Server running on port ${process.env.PORT || 3000
            }`
        );

    }

);