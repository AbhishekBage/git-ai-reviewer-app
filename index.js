import express from "express";
import fs from "fs";
import dotenv from "dotenv";
import { App } from "@octokit/app";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const server = express();

server.use(express.json({
    limit: "10mb"
}));


// =======================
// GitHub App
// =======================

const githubApp = new App({
    appId: process.env.GITHUB_APP_ID,
    privateKey: fs.readFileSync(
        process.env.GITHUB_PRIVATE_KEY_PATH,
        "utf8"
    )
});


// =======================
// Gemini
// =======================

const genAI = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});


// =======================
// AI Reviewer
// =======================

async function reviewCode(diff) {

    const prompt = `
You are a senior software engineer.

Review this Pull Request diff.

Find:
- Bugs
- Security issues
- Performance problems
- Bad practices
- Missing validations
- Code improvements

Give clear actionable feedback.

DIFF:

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
// Webhook
// =======================

server.post(
    "/github/webhook",

    async (req,res)=>{

    try {

        const event =
            req.headers["x-github-event"];


        if(event !== "pull_request"){
            return res.send(
                "ignored"
            );
        }


        const payload=req.body;


        if(
          payload.action !== "opened" &&
          payload.action !== "synchronize"
        ){
            return res.send(
                "ignored action"
            );
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
            "Reviewing PR:",
            pullNumber
        );


        // GitHub Auth

        const octokit =
            await githubApp
            .getInstallationOctokit(
                installationId
            );



        // Get PR diff

        const files =
            await octokit.rest.pulls.listFiles({
                owner,
                repo,
                pull_number:
                    pullNumber
            });



        let completeDiff="";


        for(
            const file of files.data
        ){

            completeDiff += `

FILE:
${file.filename}


PATCH:
${file.patch}

`;

        }


        console.log(
            "Sending diff to Gemini..."
        );


        const aiReview =
            await reviewCode(
                completeDiff
            );


        console.log(
            aiReview
        );



        // Post Review Comment

        await octokit.rest.issues.createComment({

            owner,

            repo,

            issue_number:
                pullNumber,


            body:
`
## 🤖 AI Code Review

${aiReview}
`

        });



        res.json({
            status:
            "review completed"
        });


    }
    catch(err){

        console.error(err);


        res.status(500)
        .json({
            error:
            err.message
        });
    }


});



server.listen(
    process.env.PORT,
    ()=>{

        console.log(
            `Server running ${process.env.PORT}`
        );

    }
);