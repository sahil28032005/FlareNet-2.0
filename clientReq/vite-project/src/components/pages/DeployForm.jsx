import React, { useState, useEffect } from "react";
import {
    Select,
    SelectTrigger,
    SelectContent,
    SelectItem,
    SelectValue,
} from "../ui/select";
import { useNavigate, useParams } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import NavBar from "../NavBar";
import Footer from "../Footer";
import axios from "axios";

import "./DeployForm.css";

//we are coming on the basis of project id on this page

const DeployForm = () => {
    const navigate = useNavigate();
    let { id } = useParams();
    // alert(id);
    const [gitUrl, setGitUrl] = useState("");
    const [projectName, setProjectName] = useState("");
    const [envVariables, setEnvVariables] = useState([{ key: "", value: "" }]);
    const [framework, setFramework] = useState("");
    const [autoDeploy, setAutoDeploy] = useState(false); //state for toggle which takee decision about webhook state
    const [isReactProject, setIsReactProject] = useState(false);
    const [validationError, setValidationError] = useState("");
    const [detectedFramework, setDetectedFramework] = useState("");
    const [customBuildCommand, setCustomBuildCommand] = useState(detectedFramework.buildCommand);

    const handleAddEnvVariable = () => {
        setEnvVariables([...envVariables, { key: "", value: "" }]);
    };

    const handleEnvVariableChange = (index, field, value) => {
        const updatedEnvVariables = [...envVariables];
        updatedEnvVariables[index][field] = value;
        setEnvVariables(updatedEnvVariables);
    };

    const handleFrameworkChange = (value) => {
        setFramework(value);
    };

    // Toggle the autoDeploy checkbox
    const handleAutoDeployChange = () => {
        setAutoDeploy(!autoDeploy);
    };

    //function to validate react project
    const fetchProjectDetails = async () => {
        try {
            if (!gitUrl) return;

            // Extract owner and repo from Git URL
            const urlParts = gitUrl.split('/');
            const owner = urlParts[urlParts.length - 2];
            const repo = urlParts[urlParts.length - 1].replace('.git', '');

            //get token from database
            const githubToken = localStorage.getItem('github_token');
            if (!githubToken) {
                throw new Error('GitHub token not found in localStorage');
            }

            //call api to validate react project
            const response = await axios.get("http://localhost:5000/api/validdeployment/validate-react", {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${githubToken}`
                },
                params: {
                    owner,
                    repo
                }
            });

            if (response.data.message === "Valid React project") {
                setIsReactProject(true);
                setDetectedFramework(response.data.framework);
                setValidationError("");
            } else {
                setIsReactProject(false);
                setValidationError(response.data.message);
            }
        }
        catch (error) {
            console.error("Error validating project:", error);
            setValidationError("Error validating project. Please check the Git URL and token.", error.message);
        }

    }
    // useEffect to validate project when Git URL changes
    useEffect(() => {
        fetchProjectDetails();
    }, [gitUrl]);

    //main deployer function
    const handleSubmit = async (e) => {
        e.preventDefault();

        // Check if the project ID exists
        if (!id) {
            alert("Project ID is missing. Cannot deploy.");
            return;
        }

        // Prepare the request body
        const requestBody = {
            projectId: id,
            autoDeploy, // Include the autoDeploy state here
        };

        try {
            // Make the POST request to deploy the project
            const response = await fetch("http://localhost:5000/deploy", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(requestBody),
            });

            if (response.ok) {
                // Parse the JSON response
                const responseData = await response.json();

                // Use the deploymentId from the response data
                navigate(`/progress/${responseData.data.deploymentId}`, {
                    state: { autoDeploy, gitUrl },
                });
            } else {
                // Parse error response
                const errorData = await response.json();
                console.error("Deployment failed:", errorData.message || "Unknown error");
                alert(`Deployment failed: ${errorData.message || "Unknown error"}`);
            }
        } catch (error) {
            console.error("Error during deployment:", error);
            alert("An error occurred while deploying the project. Please try again." + error.message);
        }

    };


    useEffect(() => {
        // Fetch project data from the backend
        const fetchProject = async () => {
            try {
                const response = await fetch(`http://localhost:5000/api/project/${id}`);
                const project = await response.json();
                if (response.ok) {
                    // Update form states with fetched project data
                    setGitUrl(project.gitUrl || "");
                    setProjectName(project.name || "");
                    setEnvVariables(project.envVariables || [{ key: "", value: "" }]);
                    setFramework(project.framework || "");
                } else {
                    console.error("Failed to fetch project:", project.error);
                }
            } catch (error) {
                console.error("Error fetching project:", error);
            }
        };

        if (id) {
            fetchProject();
        }
    }, [id]);

    return (
        <>
            <div
                style={{
                    width: "100vw",
                    background: "linear-gradient(145deg, #111111, #1c1c1c)",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    boxShadow: "inset 0 0 50px rgba(255, 255, 255, 0.1)",
                    paddingTop: "50px", // Add padding to create space from the top
                    paddingBottom: "50px", // Add padding to create space from the bottom
                }}
            >
                <div
                    className="deploy-form-container bg-gray-900 text-white p-10 rounded-lg shadow-2xl"
                    style={{
                        maxWidth: "600px",
                        width: "90%",
                        boxShadow: "0 0 20px rgba(0, 255, 85, 0.6)",
                        background:
                            "linear-gradient(145deg, rgba(0,0,0,1) 0%, rgba(34,34,34,1) 100%)",
                        border: "1px solid rgba(255, 255, 255, 0.2)",
                        marginTop: "20px", // Create extra breathing space
                    }}
                >
                    <h2 className="text-3xl font-bold mb-6 text-center">
                        Deploy Your Project
                    </h2>
                    <form onSubmit={handleSubmit}>
                        {/* Validation Status Section */}
                        <div className="mb-6">
                            {validationError && (
                                <div className="text-red-500 mb-4">{validationError}</div>
                            )}
                            {isReactProject && (
                                <div className="text-green-500 mb-4">
                                    <p>✅ Valid React Project - Detected Framework: {detectedFramework.framework}</p>
                                    <label className="block mt-2 font-semibold">Build Command:</label>
                                    <input
                                        type="text"
                                        className="border p-2 rounded w-full text-black"
                                        value={customBuildCommand}
                                        onChange={(e) => setCustomBuildCommand(e.target.value)}
                                    />
                                </div>

                            )}
                        </div>
                        <div className="mb-6">
                            <Label htmlFor="git-url" className="text-sm font-semibold">
                                Git Repository URL
                            </Label>
                            <Input
                                id="git-url"
                                type="text"
                                placeholder="Enter your Git URL"
                                value={gitUrl}
                                onChange={(e) => setGitUrl(e.target.value)}
                                className="mt-2 w-full"
                            />
                        </div>

                        <div className="mb-6">
                            <Label htmlFor="project-name" className="text-sm font-semibold">
                                Project Name
                            </Label>
                            <Input
                                id="project-name"
                                type="text"
                                placeholder="Enter your project name"
                                value={projectName}
                                onChange={(e) => setProjectName(e.target.value)}
                                className="mt-2 w-full"
                            />
                        </div>

                        <div className="mb-6">
                            <Label htmlFor="framework" className="text-sm font-semibold">
                                Framework
                            </Label>
                            <Select onValueChange={handleFrameworkChange}>
                                <SelectTrigger className="mt-2 w-full">
                                    <SelectValue placeholder="Select a framework" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="react">React</SelectItem>
                                    <SelectItem value="nextjs">Next.js</SelectItem>
                                    <SelectItem value="angular">Angular</SelectItem>
                                    <SelectItem value="vue">Vue</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="mb-6">
                            <Label className="text-sm font-semibold">
                                Environment Variables
                            </Label>
                            {envVariables.map((env, index) => (
                                <div key={index} className="flex gap-4 mt-4">
                                    <Input
                                        type="text"
                                        placeholder="Key"
                                        value={env.key}
                                        onChange={(e) =>
                                            handleEnvVariableChange(index, "key", e.target.value)
                                        }
                                        className="flex-1"
                                    />
                                    <Input
                                        type="text"
                                        placeholder="Value"
                                        value={env.value}
                                        onChange={(e) =>
                                            handleEnvVariableChange(index, "value", e.target.value)
                                        }
                                        className="flex-1"
                                    />
                                </div>
                            ))}
                            <Button
                                type="button"
                                onClick={handleAddEnvVariable}
                                className="mt-4 bg-yellow-500 text-black hover:bg-yellow-600"
                            >
                                Add Variable
                            </Button>
                        </div>

                        <div className="mb-6">
                            <Label htmlFor="project-info" className="text-sm font-semibold">
                                Project Information
                            </Label>
                            <Textarea
                                id="project-info"
                                placeholder="Enter basic information about your project"
                                className="mt-2 w-full"
                            />
                        </div>

                        <div className="mb-6">
                            <Label className="text-sm font-semibold">Auto Deploy</Label>
                            <div className="flex items-center">
                                <input
                                    type="checkbox"
                                    checked={autoDeploy}
                                    onChange={handleAutoDeployChange}
                                    className="mr-2"
                                />
                                <span>Enable Auto Deployment</span>
                            </div>
                        </div>

                        <Button
                            type="submit"
                            className="w-full bg-yellow-500 text-black hover:bg-yellow-600"
                            disabled={!isReactProject} // Disable button if not a React project
                        >
                            Deploy
                        </Button>

                    </form>
                </div>
            </div>
        </>

    );
};

export default DeployForm;
